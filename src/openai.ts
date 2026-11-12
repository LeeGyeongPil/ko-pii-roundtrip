// openai(v7) 클라이언트 래퍼: chat.completions.create 만 가로챈다.
//
//   const vault = createVault();
//   const client = wrapOpenAI(new OpenAI(), { vault });
//   const stream = await client.chat.completions.create({ model, messages, stream: true });
//   for await (const chunk of stream) process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
//
// - 요청: messages 의 글(문자열·text 파트)과 assistant 의 tool_calls 인자를 가명으로 바꾼다.
// - 응답: content 와 tool_calls[].function.arguments 를 복원한다(스트리밍이면 choice 마다 보류 버퍼).
// 'openai' 패키지는 불러오지 않는다. 모양(구조)만 맞으면 감쌀 수 있다.

import { KoPiiError } from './errors';
import { createJsonStringRestorer, restoreJsonText } from './json-stream';
import { pseudonymize } from './pseudonymize';
import { assertDetectOptions, assertKnownKeys, assertOptions, assertVault } from './validate';
import { restore } from './restore';
import { createStreamRestorer } from './stream';
import { optionKeys, type DetectOptions, type StreamRestorer, type Vault } from './types';
import { mapJsonText } from './walk';

/** 감쌀 수 있는 클라이언트의 최소 모양 */
export interface OpenAILike {
  chat: { completions: { create: (...args: never[]) => unknown } };
}

export interface WrapOpenAIOptions {
  /** 대화 단위 vault */
  vault: Vault;
  detect?: DetectOptions;
  /** 복원할 때 조사도 고칠지. 기본 true */
  josa?: boolean;
}

/** Keys accepted by wrapOpenAI() (kept in sync with WrapOpenAIOptions by the type check). */
const WRAP_OPTION_KEYS = optionKeys<WrapOpenAIOptions>({ vault: true, detect: true, josa: true });

// ---- openai 응답·요청의 필요한 부분만 느슨하게 적은 모양 ----
type Obj = Record<string, unknown>;
interface ToolCallLike extends Obj {
  index?: number;
  function?: { name?: string; arguments?: string } & Obj;
}
interface DeltaLike extends Obj {
  content?: string | null;
  tool_calls?: ToolCallLike[];
}
interface ChoiceLike extends Obj {
  index: number;
  delta?: DeltaLike;
  message?: DeltaLike;
  finish_reason?: string | null;
}
interface ChunkLike extends Obj {
  choices?: ChoiceLike[];
}

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null;
}

/** 객체의 메서드를 원래 객체에 묶어 둔다(private 필드를 쓰는 SDK 클래스가 Proxy 너머에서도 동작하도록) */
function forward(target: object, prop: string | symbol): unknown {
  const v = Reflect.get(target, prop, target) as unknown;
  return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
}

export function wrapOpenAI<T extends OpenAILike>(client: T, opts: WrapOpenAIOptions): T {
  assertOptions(opts, 'wrapOpenAI(client, options)', 'wrapOpenAI(new OpenAI(), { vault: createVault() })');
  assertKnownKeys(opts, WRAP_OPTION_KEYS, 'wrapOpenAI(client, options)', (key) =>
    key === 'names' || key === 'detectors'
      ? `Put it under detect, e.g. wrapOpenAI(client, { vault, detect: { ${key}: [...] } }).`
      : undefined,
  );
  assertDetectOptions(opts.detect, 'wrapOpenAI(client, { detect })');
  assertVault(opts.vault, 'wrapOpenAI(client, { vault })');
  const createFn = (client as { chat?: { completions?: { create?: unknown } } } | null | undefined)?.chat?.completions?.create;
  if (typeof createFn !== 'function') {
    throw new KoPiiError('wrapOpenAI(client, options) needs an OpenAI-style client with client.chat.completions.create(). Pass new OpenAI() (or a compatible client).');
  }
  const { vault } = opts;
  const josa = opts.josa ?? true;
  const hide = (s: string): string => pseudonymize(s, vault, opts.detect);
  const show = (s: string): string => restore(s, vault, { josa });

  // ---- 요청 ----
  function hideMessage(m: unknown): unknown {
    if (!isObj(m)) return m;
    const out: Obj = { ...m };
    if (typeof m.content === 'string') out.content = hide(m.content);
    else if (Array.isArray(m.content)) {
      // text 파트만 바꾼다(이미지·오디오·파일 파트는 그대로)
      out.content = m.content.map((p: unknown) =>
        isObj(p) && p.type === 'text' && typeof p.text === 'string' ? { ...p, text: hide(p.text) } : p,
      );
    }
    if (Array.isArray(m.tool_calls)) {
      out.tool_calls = m.tool_calls.map((tc: unknown) => {
        if (!isObj(tc) || !isObj(tc.function) || typeof tc.function.arguments !== 'string') return tc;
        return { ...tc, function: { ...tc.function, arguments: mapJsonText(tc.function.arguments, hide) } };
      });
    }
    return out;
  }

  // ---- 응답(한 번에) ----
  function showMessage(msg: DeltaLike): DeltaLike {
    const out: DeltaLike = { ...msg };
    if (typeof msg.content === 'string') out.content = show(msg.content);
    if (Array.isArray(msg.tool_calls)) {
      out.tool_calls = msg.tool_calls.map((tc) =>
        typeof tc.function?.arguments === 'string'
          ? { ...tc, function: { ...tc.function, arguments: restoreJsonText(tc.function.arguments, vault, { josa }) } }
          : tc,
      );
    }
    return out;
  }

  function showCompletion(res: unknown): unknown {
    if (!isObj(res) || !Array.isArray(res.choices)) return res;
    const choices = (res.choices as ChoiceLike[]).map((c) => (isObj(c.message) ? { ...c, message: showMessage(c.message) } : c));
    return { ...res, choices };
  }

  // ---- 응답(스트리밍) ----
  function showStream(stream: AsyncIterable<ChunkLike> & { controller?: unknown }): unknown {
    async function* restored(): AsyncGenerator<ChunkLike> {
      const content = new Map<number, StreamRestorer>(); // choice 번호 → 복원기
      const args = new Map<string, StreamRestorer>(); // 'choice:도구번호' → JSON 복원기
      let last: ChunkLike | null = null;

      const contentOf = (i: number): StreamRestorer => {
        let r = content.get(i);
        if (r === undefined) content.set(i, (r = createStreamRestorer(vault, { josa })));
        return r;
      };
      const argsOf = (i: number, t: number): StreamRestorer => {
        let r = args.get(`${i}:${t}`);
        if (r === undefined) args.set(`${i}:${t}`, (r = createJsonStringRestorer(vault, { josa })));
        return r;
      };
      /** choice 하나의 남은 꼬리를 delta 에 덧붙인다 */
      const flushChoice = (i: number, delta: DeltaLike): DeltaLike => {
        const out: DeltaLike = { ...delta };
        const r = content.get(i);
        if (r !== undefined) {
          content.delete(i);
          const tail = r.flush();
          if (tail !== '') out.content = (out.content ?? '') + tail;
        }
        const extra: ToolCallLike[] = [];
        for (const [key, ar] of [...args]) {
          const [ci, ti] = key.split(':').map(Number) as [number, number];
          if (ci !== i) continue;
          args.delete(key);
          const tail = ar.flush();
          if (tail !== '') extra.push({ index: ti, function: { arguments: tail } });
        }
        if (extra.length > 0) out.tool_calls = [...(out.tool_calls ?? []), ...extra];
        return out;
      };

      for await (const chunk of stream) {
        last = chunk;
        if (!Array.isArray(chunk.choices)) {
          yield chunk;
          continue;
        }
        const choices = chunk.choices.map((choice) => {
          const d = choice.delta ?? {};
          let delta: DeltaLike = { ...d };
          if (typeof d.content === 'string') delta.content = contentOf(choice.index).push(d.content);
          if (Array.isArray(d.tool_calls)) {
            delta.tool_calls = d.tool_calls.map((tc) =>
              typeof tc.function?.arguments === 'string'
                ? {
                    ...tc,
                    function: { ...tc.function, arguments: argsOf(choice.index, tc.index ?? 0).push(tc.function.arguments) },
                  }
                : tc,
            );
          }
          // 이 choice 가 끝났으면 보류해 둔 꼬리를 같은 조각에 붙여 내보낸다
          if (choice.finish_reason !== null && choice.finish_reason !== undefined) delta = flushChoice(choice.index, delta);
          return { ...choice, delta };
        });
        yield { ...chunk, choices };
      }

      // finish_reason 없이 끝난 스트림: 남은 꼬리를 마지막 조각 하나로 내보낸다
      const pending = new Set<number>([...content.keys(), ...[...args.keys()].map((k) => Number(k.split(':')[0]))]);
      const tails: ChoiceLike[] = [];
      for (const i of [...pending].sort((a, b) => a - b)) {
        const delta = flushChoice(i, {});
        if (delta.content !== undefined || delta.tool_calls !== undefined) {
          tails.push({ index: i, delta, finish_reason: null, logprobs: null });
        }
      }
      if (tails.length > 0) yield { ...(last ?? {}), choices: tails };
    }

    return {
      [Symbol.asyncIterator]: restored,
      /** 원래 스트림의 AbortController. controller.abort() 로 요청을 끊는다 */
      controller: stream.controller,
      tee(): never {
        throw new KoPiiError('wrapOpenAI 로 감싼 스트림은 tee() 를 지원하지 않습니다. for await 로 한 번만 읽으세요.');
      },
      toReadableStream(): ReadableStream<Uint8Array> {
        // openai Stream.toReadableStream 과 같은 꼴(JSON 한 줄씩)
        const iter = restored();
        const enc = new TextEncoder();
        return new ReadableStream<Uint8Array>({
          async pull(ctl) {
            const { value, done } = await iter.next();
            if (done === true) ctl.close();
            else ctl.enqueue(enc.encode(JSON.stringify(value) + '\n'));
          },
          async cancel() {
            await iter.return(undefined);
          },
        });
      },
    };
  }

  const completions = client.chat.completions;
  const originalCreate = completions.create as unknown as (body: unknown, options?: unknown) => PromiseLike<unknown>;

  async function create(body: unknown, options?: unknown): Promise<unknown> {
    const sent = isObj(body) && Array.isArray(body.messages) ? { ...body, messages: body.messages.map(hideMessage) } : body;
    const res = await originalCreate.call(completions, sent, options);
    if (isObj(body) && body.stream === true && isObj(res) && Symbol.asyncIterator in res) {
      return showStream(res as unknown as AsyncIterable<ChunkLike>);
    }
    return showCompletion(res);
  }

  const completionsProxy = new Proxy(completions, {
    get: (target, prop) => (prop === 'create' ? create : forward(target, prop)),
  });
  const chatProxy = new Proxy(client.chat, {
    get: (target, prop) => (prop === 'completions' ? completionsProxy : forward(target, prop)),
  });
  return new Proxy(client, {
    get: (target, prop) => (prop === 'chat' ? chatProxy : forward(target, prop)),
  });
}
