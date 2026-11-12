// Vercel AI SDK(ai@7) 언어 모델 미들웨어(명세 v4).
//
//   const vault = createVault();                       // 대화 하나당 하나
//   const model = wrapLanguageModel({ model: base, middleware: piiMiddleware({ vault }) });
//   const r = streamText({ model, prompt: '고객 이예시님(010-0000-1234)이 환불 요청' });
//
// - transformParams: 모델로 가기 전 프롬프트의 글(system·user·assistant·tool 결과)을 가명으로 바꾼다.
// - wrapGenerate: 모델 답 전체를 한 번에 복원한다.
// - wrapStream: text/reasoning 블록 id 마다 보류 버퍼 복원기를, 도구 인자 id 마다 JSON 복원기를 둔다.
//
// 'ai' 는 타입으로만 불러온다(import type). 실행 중에는 'ai' 를 불러오지 않는다.

import type { LanguageModelMiddleware } from 'ai';
import { createJsonStringRestorer, restoreJsonText } from './json-stream';
import { pseudonymize } from './pseudonymize';
import { restore } from './restore';
import { createStreamRestorer } from './stream';
import type { DetectOptions, StreamRestorer, Vault } from './types';
import { assertDetectOptions, assertKnownKeys, assertOptions, assertVault } from './validate';
import { optionKeys } from './types';
import { mapStrings } from './walk';

// ---- ai 의 미들웨어 타입에서 필요한 타입을 꺼낸다 ----
type TransformParams = NonNullable<LanguageModelMiddleware['transformParams']>;
type CallOptions = Awaited<ReturnType<TransformParams>>;
type Message = CallOptions['prompt'][number];
type WrapGenerate = NonNullable<LanguageModelMiddleware['wrapGenerate']>;
type GenerateResult = Awaited<ReturnType<WrapGenerate>>;
type Content = GenerateResult['content'][number];
type WrapStream = NonNullable<LanguageModelMiddleware['wrapStream']>;
type StreamResult = Awaited<ReturnType<WrapStream>>;
type StreamPart = StreamResult['stream'] extends ReadableStream<infer P> ? P : never;

export interface PiiMiddlewareOptions {
  /** 대화 단위 vault. 다음 턴에도 같은 vault 를 넘겨야 같은 사람이 같은 가명이 된다 */
  vault: Vault;
  /** 탐지 옵션(켤 탐지기·이름 사전) */
  detect?: DetectOptions;
  /** 추론(reasoning) 글도 복원할지. 기본 true */
  restoreReasoning?: boolean;
  /** 복원할 때 조사도 고칠지. 기본 true */
  josa?: boolean;
}

/** Keys accepted by piiMiddleware() (kept in sync with PiiMiddlewareOptions by the type check). */
const MIDDLEWARE_OPTION_KEYS = optionKeys<PiiMiddlewareOptions>({ vault: true, detect: true, restoreReasoning: true, josa: true });

/** piiMiddleware 가 돌려주는 객체. ai 의 LanguageModelMiddleware 에 그대로 넣을 수 있다 */
export type PiiMiddleware = LanguageModelMiddleware & { readonly specificationVersion: 'v4' };

export function piiMiddleware(opts: PiiMiddlewareOptions): PiiMiddleware {
  assertOptions(opts, 'piiMiddleware(options)', 'piiMiddleware({ vault: createVault() })');
  assertKnownKeys(opts, MIDDLEWARE_OPTION_KEYS, 'piiMiddleware(options)', (key) =>
    key === 'names' || key === 'detectors'
      ? `Put it under detect, e.g. piiMiddleware({ vault, detect: { ${key}: [...] } }).`
      : undefined,
  );
  assertDetectOptions(opts.detect, 'piiMiddleware({ detect })');
  assertVault(opts.vault, 'piiMiddleware({ vault })');
  const { vault } = opts;
  const restoreReasoning = opts.restoreReasoning ?? true;
  const josa = opts.josa ?? true;

  const hide = (s: string): string => pseudonymize(s, vault, opts.detect);
  const hideDeep = <T>(v: T): T => mapStrings(v, hide) as T;
  const show = (s: string): string => restore(s, vault, { josa });
  const showDeep = <T>(v: T): T => mapStrings(v, show) as T;

  // ---- 요청: 프롬프트를 가명으로 ----
  type ToolResultOutput = Extract<Extract<Message, { role: 'tool' }>['content'][number], { type: 'tool-result' }>['output'];

  /** 도구 결과: 글·JSON 값만 바꾸고, 파일(base64 등) 데이터는 건드리지 않는다 */
  function hideToolOutput(o: ToolResultOutput): ToolResultOutput {
    switch (o.type) {
      case 'text':
      case 'error-text':
        return { ...o, value: hide(o.value) };
      case 'json':
      case 'error-json':
        return { ...o, value: hideDeep(o.value) };
      case 'execution-denied':
        return o.reason === undefined ? o : { ...o, reason: hide(o.reason) };
      case 'content':
        return { ...o, value: o.value.map((item) => (item.type === 'text' ? { ...item, text: hide(item.text) } : item)) };
      default:
        return o;
    }
  }

  function hideMessage(m: Message): Message {
    switch (m.role) {
      case 'system':
        return { ...m, content: hide(m.content) };
      case 'user':
        // 파일 파트(이미지·PDF)는 내용을 읽지 않는다 — README 의 한계 참고
        return { ...m, content: m.content.map((p) => (p.type === 'text' ? { ...p, text: hide(p.text) } : p)) };
      case 'assistant':
        return {
          ...m,
          content: m.content.map((p) => {
            if (p.type === 'text' || p.type === 'reasoning') return { ...p, text: hide(p.text) };
            if (p.type === 'tool-call') return { ...p, input: hideDeep(p.input) };
            if (p.type === 'tool-result') return { ...p, output: hideToolOutput(p.output) };
            return p;
          }),
        };
      case 'tool':
        return {
          ...m,
          content: m.content.map((p) => (p.type === 'tool-result' ? { ...p, output: hideToolOutput(p.output) } : p)),
        };
      default:
        return m;
    }
  }

  // ---- 응답(한 번에): 내용 전체를 복원 ----
  function showContent(c: Content): Content {
    switch (c.type) {
      case 'text':
        return { ...c, text: show(c.text) };
      case 'reasoning':
        return restoreReasoning ? { ...c, text: show(c.text) } : c;
      case 'tool-call':
        return { ...c, input: restoreJsonText(c.input, vault, { josa }) };
      case 'tool-result':
        return { ...c, result: showDeep(c.result) };
      default:
        return c;
    }
  }

  return {
    specificationVersion: 'v4',

    transformParams: async ({ params }) => ({ ...params, prompt: params.prompt.map(hideMessage) }),

    wrapGenerate: async ({ doGenerate }) => {
      const result = await doGenerate();
      return { ...result, content: result.content.map(showContent) };
    },

    wrapStream: async ({ doStream }) => {
      const { stream, ...rest } = await doStream();
      // 블록 id 별 복원기. 조각을 델타마다 따로 바꾸면 '[이름' + '_1]' 처럼 새므로 블록 단위로 이어 본다.
      const open = new Map<string, { restorer: StreamRestorer; kind: 'text' | 'reasoning' | 'tool-input' }>();

      function restorerFor(kind: 'text' | 'reasoning' | 'tool-input', id: string): StreamRestorer {
        const key = `${kind}:${id}`;
        let entry = open.get(key);
        if (entry === undefined) {
          const restorer = kind === 'tool-input' ? createJsonStringRestorer(vault, { josa }) : createStreamRestorer(vault, { josa });
          entry = { restorer, kind };
          open.set(key, entry);
        }
        return entry.restorer;
      }

      /** 블록 하나를 닫으며 남은 꼬리를 델타 하나로 내보낸다 */
      function flushOne(kind: 'text' | 'reasoning' | 'tool-input', id: string): StreamPart | null {
        const key = `${kind}:${id}`;
        const entry = open.get(key);
        if (entry === undefined) return null;
        open.delete(key);
        const tail = entry.restorer.flush();
        if (tail === '') return null;
        if (kind === 'text') return { type: 'text-delta', id, delta: tail };
        if (kind === 'reasoning') return { type: 'reasoning-delta', id, delta: tail };
        return { type: 'tool-input-delta', id, delta: tail };
      }

      /** 끝 표시(text-end 등) 없이 스트림이 끝나거나 finish 가 오면 열린 블록을 모두 비운다 */
      function flushAll(ctl: TransformStreamDefaultController<StreamPart>): void {
        for (const key of [...open.keys()]) {
          const [kind, ...idParts] = key.split(':') as ['text' | 'reasoning' | 'tool-input', ...string[]];
          const part = flushOne(kind, idParts.join(':'));
          if (part !== null) ctl.enqueue(part);
        }
      }

      const restoreParts = new TransformStream<StreamPart, StreamPart>({
        transform(part, ctl) {
          switch (part.type) {
            case 'text-delta': {
              const out = restorerFor('text', part.id).push(part.delta);
              if (out !== '') ctl.enqueue({ ...part, delta: out });
              return;
            }
            case 'reasoning-delta': {
              if (!restoreReasoning) break;
              const out = restorerFor('reasoning', part.id).push(part.delta);
              if (out !== '') ctl.enqueue({ ...part, delta: out });
              return;
            }
            case 'tool-input-delta': {
              const out = restorerFor('tool-input', part.id).push(part.delta);
              if (out !== '') ctl.enqueue({ ...part, delta: out });
              return;
            }
            case 'text-end':
            case 'reasoning-end':
            case 'tool-input-end': {
              const kind = part.type === 'text-end' ? 'text' : part.type === 'reasoning-end' ? 'reasoning' : 'tool-input';
              const tail = flushOne(kind, part.id);
              if (tail !== null) ctl.enqueue(tail);
              break;
            }
            case 'tool-call':
              ctl.enqueue({ ...part, input: restoreJsonText(part.input, vault, { josa }) });
              return;
            case 'tool-result':
              ctl.enqueue({ ...part, result: showDeep(part.result) });
              return;
            case 'finish':
            case 'error':
              flushAll(ctl); // 끝 표시 없이 끝난 블록의 꼬리를 finish 앞에 내보낸다
              break;
            default:
              break;
          }
          ctl.enqueue(part);
        },
        flush(ctl) {
          flushAll(ctl); // finish 조차 없이 끝난 스트림
        },
      });

      return { stream: stream.pipeThrough(restoreParts), ...rest };
    },
  };
}
