// AC-6: openai 래퍼 — fetch 를 주입한 연습용 목(가짜 SSE)으로 네트워크 없이 확인한다.

import OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import { createVault, KoPiiError } from '../src/index';
import { wrapOpenAI } from '../src/openai';
import { NAMES, SYN } from './fixtures/synthetic';

const TRICKY = '김"가명\\';
const ORIGINALS = [NAMES.lee, NAMES.kim, SYN.phone1234, SYN.rrnChecksumMale, SYN.account, TRICKY];
const MODEL_ANSWER = '[이름_1]은 [전화_1]으로 연락하고, [이름_1]을 [이름_2]과 연결하세요.';
const EXPECTED = `${NAMES.lee}는 ${SYN.phone1234}로 연락하고, ${NAMES.lee}를 ${NAMES.kim}과 연결하세요.`;
const USER_TEXT = `고객 ${NAMES.lee}님(${SYN.phone1234})이 ${NAMES.kim}님과 통화 원함. 주민 ${SYN.rrnChecksumMale}`;

function leaked(body: string): string[] {
  return ORIGINALS.filter((v) => body.includes(v) || body.includes(JSON.stringify(v).slice(1, -1)));
}

function splitBy(text: string, sizes: number[]): string[] {
  const out: string[] = [];
  for (let i = 0, k = 0; i < text.length; k++) {
    const n = sizes[k % sizes.length] as number;
    out.push(text.slice(i, i + n));
    i += n;
  }
  return out;
}

interface FakeServer {
  fetch: typeof fetch;
  bodies: string[];
}

/** 받은 요청 본문을 기록하고 정해 둔 응답을 돌려주는 가짜 fetch(포트를 열지 않는다) */
function fakeServer(respond: () => Response): FakeServer {
  const bodies: string[] = [];
  const f = async (_url: unknown, init?: RequestInit): Promise<Response> => {
    bodies.push(String(init?.body ?? ''));
    return respond();
  };
  return { fetch: f as typeof fetch, bodies };
}

function sse(chunks: object[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify(ch)}\n\n`));
      c.enqueue(enc.encode('data: [DONE]\n\n'));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function chunk(delta: object, finish: string | null = null): object {
  return { id: 'x', object: 'chat.completion.chunk', created: 0, model: 'mock', choices: [{ index: 0, delta, finish_reason: finish }] };
}

function client(server: FakeServer): OpenAI {
  return new OpenAI({ apiKey: 'mock', baseURL: 'http://mock.invalid/v1', fetch: server.fetch, maxRetries: 0 });
}

describe('AC-6 openai 래퍼', () => {
  it('non-stream: 요청 본문에 원래 값 0건, 응답 content·tool_calls 복원', async () => {
    const server = fakeServer(
      () =>
        new Response(
          JSON.stringify({
            id: 'x',
            object: 'chat.completion',
            created: 0,
            model: 'mock',
            choices: [
              {
                index: 0,
                finish_reason: 'stop',
                message: {
                  role: 'assistant',
                  content: MODEL_ANSWER,
                  tool_calls: [{ id: 'c1', type: 'function', function: { name: 'lookup', arguments: '{"name":"[이름_3]"}' } }],
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const vault = createVault();
    const ai = wrapOpenAI(client(server), { vault, detect: { names: [TRICKY] } });
    const res = await ai.chat.completions.create({
      model: 'mock',
      messages: [
        { role: 'system', content: `담당 고객 ${NAMES.lee}님` },
        { role: 'user', content: [{ type: 'text', text: USER_TEXT }] },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'c0', type: 'function', function: { name: 'lookup', arguments: JSON.stringify({ name: TRICKY }) } }],
        },
        { role: 'tool', tool_call_id: 'c0', content: `계좌: 국민은행 ${SYN.account}` },
      ],
    });

    expect(server.bodies).toHaveLength(1);
    expect(leaked(server.bodies[0] as string)).toEqual([]);
    const msg = res.choices[0]?.message;
    expect(msg?.content).toBe(EXPECTED);
    const args = msg?.tool_calls?.[0];
    expect(args?.type === 'function' ? JSON.parse(args.function.arguments) : null).toEqual({ name: TRICKY });
  });

  it('stream: 어떤 크기로 쪼개진 SSE 든 복원 결과가 같고 가명 조각이 새지 않는다', async () => {
    for (const sizes of [[1], [3, 2], [6, 1, 4]]) {
      const parts = splitBy(MODEL_ANSWER, sizes);
      const server = fakeServer(() =>
        sse([chunk({ role: 'assistant', content: '' }), ...parts.map((p) => chunk({ content: p })), chunk({}, 'stop')]),
      );
      const vault = createVault();
      const ai = wrapOpenAI(client(server), { vault });
      const stream = await ai.chat.completions.create({ model: 'mock', messages: [{ role: 'user', content: USER_TEXT }], stream: true });
      let out = '';
      for await (const ch of stream) {
        const piece = ch.choices[0]?.delta?.content ?? '';
        expect(piece).not.toMatch(/\[이름|\[전화/);
        out += piece;
      }
      expect(out).toBe(EXPECTED);
      expect(leaked(server.bodies[0] as string)).toEqual([]);
    }
  });

  it('stream: finish_reason 없이 끝나도 남은 꼬리를 마지막 조각으로 내보낸다', async () => {
    const server = fakeServer(() => sse([chunk({ content: '담당은 [이름' }), chunk({ content: '_1]' })]));
    const vault = createVault();
    const ai = wrapOpenAI(client(server), { vault });
    const stream = await ai.chat.completions.create({ model: 'mock', messages: [{ role: 'user', content: USER_TEXT }], stream: true });
    let out = '';
    for await (const ch of stream) out += ch.choices[0]?.delta?.content ?? '';
    expect(out).toBe(`담당은 ${NAMES.lee}`);
  });

  it('stream: tool_calls[].function.arguments 조각을 이어 붙이면 원래 값이 든 올바른 JSON', async () => {
    const args = JSON.stringify({ name: '[이름_1]', phone: '[전화_1]', memo: '[이름_1]은 VIP' });
    const pieces = splitBy(args, [4, 1, 7]);
    const server = fakeServer(() =>
      sse([
        chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'lookup', arguments: '' } }] }),
        ...pieces.map((p) => chunk({ tool_calls: [{ index: 0, function: { arguments: p } }] })),
        chunk({}, 'tool_calls'),
      ]),
    );
    const vault = createVault();
    const ai = wrapOpenAI(client(server), { vault, detect: { names: [TRICKY] } });
    const stream = await ai.chat.completions.create({
      model: 'mock',
      messages: [{ role: 'user', content: `${TRICKY} 고객(${SYN.phone1234}) 조회` }],
      stream: true,
    });
    let joined = '';
    for await (const ch of stream) {
      for (const tc of ch.choices[0]?.delta?.tool_calls ?? []) joined += tc.function?.arguments ?? '';
    }
    expect(JSON.parse(joined)).toEqual({ name: TRICKY, phone: SYN.phone1234, memo: `${TRICKY}은 VIP` });
    expect(leaked(server.bodies[0] as string)).toEqual([]);
  });

  it('다른 메서드·속성은 원래 클라이언트로 그대로 간다', async () => {
    const server = fakeServer(() => sse([chunk({ content: 'ok' }, 'stop')]));
    const raw = client(server);
    const ai = wrapOpenAI(raw, { vault: createVault() });
    expect(ai.baseURL).toBe(raw.baseURL);
    expect(typeof ai.models.list).toBe('function');
    const stream = await ai.chat.completions.create({ model: 'mock', messages: [{ role: 'user', content: 'hi' }], stream: true });
    expect(stream.controller).toBeInstanceOf(AbortController);
    expect(() => stream.tee()).toThrow(KoPiiError);
  });

  it('for await 를 중간에 멈추면 원래 스트림도 닫힌다(요청 중단)', async () => {
    let cancelled = false;
    const enc = new TextEncoder();
    const server = fakeServer(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(c) {
              c.enqueue(enc.encode(`data: ${JSON.stringify(chunk({ content: '가나다 ' }))}\n\n`));
            },
            cancel() {
              cancelled = true;
            },
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    const ai = wrapOpenAI(client(server), { vault: createVault() });
    const stream = await ai.chat.completions.create({ model: 'mock', messages: [{ role: 'user', content: 'hi' }], stream: true });
    let n = 0;
    for await (const _ of stream) {
      if (++n === 3) break; // 끝없는 스트림을 3조각만 읽고 멈춘다
    }
    expect(n).toBe(3);
    expect(stream.controller.signal.aborted || cancelled).toBe(true);
  });
});
