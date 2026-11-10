// AC-5: AI SDK 미들웨어 — 연습용 목(MockLanguageModelV4)으로 네트워크 없이 확인한다.
// - 모델에 넘어간 프롬프트(system·user·assistant·tool-call input·tool-result)에 원래 값 0건
// - generateText·streamText 결과가 기대 복원문과 같다(조사 교정 포함)
// - 따옴표·역슬래시가 든 원래 값이 도구 인자로 돌아와도 JSON 이 깨지지 않는다

import { generateText, jsonSchema, stepCountIs, streamText, tool, wrapLanguageModel, type ModelMessage } from 'ai';
import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { piiMiddleware } from '../src/ai-sdk';
import { createVault } from '../src/index';
import { NAMES, SYN } from './fixtures/synthetic';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const stop = { unified: 'stop', raw: 'stop' } as const;
const toolCalls = { unified: 'tool-calls', raw: 'tool_calls' } as const;

const TRICKY = '김"가명\\'; // 따옴표·역슬래시가 든 이름(사용자 사전으로 등록)
const ORIGINALS = [NAMES.lee, NAMES.kim, SYN.phone1234, SYN.rrnChecksumMale, SYN.brn, SYN.account, SYN.email, TRICKY];

function leaked(prompt: unknown): string[] {
  const s = JSON.stringify(prompt);
  // JSON.stringify 가 따옴표·역슬래시를 이스케이프하므로 TRICKY 는 이스케이프된 꼴로도 찾는다
  return ORIGINALS.filter((v) => s.includes(v) || s.includes(JSON.stringify(v).slice(1, -1)));
}

/** 목 모델이 쓰는 답: 가명을 인용하고, 가명 번호('일')에 맞춘 조사를 붙인다(실제 모델이 흔히 하는 실수) */
const MODEL_ANSWER = '[이름_1]은 [전화_1]으로 연락하고, [이름_1]을 [이름_2]과 연결하세요.';
const EXPECTED = `${NAMES.lee}는 ${SYN.phone1234}로 연락하고, ${NAMES.lee}를 ${NAMES.kim}과 연결하세요.`;
const USER_TEXT = `고객 ${NAMES.lee}님(${SYN.phone1234})이 ${NAMES.kim}님과 통화 원함. 주민 ${SYN.rrnChecksumMale}`;

function splitBy(text: string, sizes: number[]): string[] {
  const out: string[] = [];
  let i = 0;
  let k = 0;
  while (i < text.length) {
    const n = sizes[k++ % sizes.length] as number;
    out.push(text.slice(i, i + n));
    i += n;
  }
  return out;
}

describe('AC-5 AI SDK 미들웨어', () => {
  it('generateText: 모델은 가명만 받고, 앱은 복원·조사 교정된 답을 받는다', async () => {
    const vault = createVault();
    const mock = new MockLanguageModelV4({
      doGenerate: async () => ({ content: [{ type: 'text', text: MODEL_ANSWER }], finishReason: stop, usage, warnings: [] }),
    });
    const model = wrapLanguageModel({ model: mock, middleware: piiMiddleware({ vault }) });
    const r = await generateText({ model, prompt: USER_TEXT });

    const sent = mock.doGenerateCalls[0]?.prompt;
    expect(leaked(sent)).toEqual([]);
    expect(JSON.stringify(sent)).toContain('고객 [이름_1]님([전화_1])이 [이름_2]님과 통화 원함. 주민 [주민번호_1]');
    expect(r.text).toBe(EXPECTED);
  });

  it('프롬프트의 system·user·assistant(text·tool-call)·tool-result 전부 가명 처리된다', async () => {
    const vault = createVault();
    const mock = new MockLanguageModelV4({
      doGenerate: async () => ({ content: [{ type: 'text', text: '확인했습니다.' }], finishReason: stop, usage, warnings: [] }),
    });
    const model = wrapLanguageModel({ model: mock, middleware: piiMiddleware({ vault, detect: { names: [TRICKY] } }) });
    const messages: ModelMessage[] = [
      { role: 'user', content: [{ type: 'text', text: USER_TEXT }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: `${NAMES.lee}님을 조회합니다.` }, // 이전 답(복원돼 있던 글)
          { type: 'tool-call', toolCallId: 'c1', toolName: 'lookup', input: { name: TRICKY, phone: SYN.phone1234 } },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'lookup',
            output: { type: 'json', value: { account: `국민은행 ${SYN.account}`, brn: SYN.brn, email: SYN.email } },
          },
        ],
      },
      { role: 'user', content: `${TRICKY} 고객님께 안내문을 써 주세요.` },
    ];
    await generateText({ model, system: `상담 기록. 담당 고객 ${NAMES.kim}님`, messages });

    const sent = mock.doGenerateCalls[0]?.prompt;
    expect(leaked(sent)).toEqual([]);
    const roles = sent?.map((m) => m.role);
    expect(roles).toEqual(['system', 'user', 'assistant', 'tool', 'user']);
  });

  it('streamText: 답이 1~6글자 조각으로 쪼개져 와도 복원 결과가 같다', async () => {
    for (const sizes of [[1], [2, 5], [6, 1, 3], [4, 4, 1, 6]]) {
      const vault = createVault();
      const parts = splitBy(MODEL_ANSWER, sizes);
      const mock = new MockLanguageModelV4({
        doStream: async () => ({
          stream: convertArrayToReadableStream([
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 't0' },
            ...parts.map((delta) => ({ type: 'text-delta' as const, id: 't0', delta })),
            { type: 'text-end', id: 't0' },
            { type: 'finish', finishReason: stop, usage },
          ]),
        }),
      });
      const model = wrapLanguageModel({ model: mock, middleware: piiMiddleware({ vault }) });
      const r = streamText({ model, prompt: USER_TEXT });
      const seen: string[] = [];
      for await (const d of r.textStream) seen.push(d);
      expect(seen.join('')).toBe(EXPECTED);
      for (const d of seen) expect(d).not.toMatch(/\[이름|_1\]|\[전화/); // 가명 조각이 화면에 새지 않는다
      expect(leaked(mock.doStreamCalls[0]?.prompt)).toEqual([]);
    }
  });

  it('text-end 없이 finish 로 끝난 스트림도 꼬리를 잃지 않는다', async () => {
    const vault = createVault();
    const mock = new MockLanguageModelV4({
      doStream: async () => ({
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 't0' },
          { type: 'text-delta', id: 't0', delta: '담당은 [이름_' },
          { type: 'text-delta', id: 't0', delta: '1]' }, // 가명으로 끝나 조사 판정을 위해 붙잡혀 있다
          { type: 'finish', finishReason: stop, usage },
        ]),
      }),
    });
    const model = wrapLanguageModel({ model: mock, middleware: piiMiddleware({ vault }) });
    const r = streamText({ model, prompt: USER_TEXT });
    expect(await r.text).toBe(`담당은 ${NAMES.lee}`);
  });

  it('reasoning 도 복원하고, restoreReasoning:false 면 그대로 둔다', async () => {
    for (const restoreReasoning of [true, false]) {
      const vault = createVault();
      const mock = new MockLanguageModelV4({
        doStream: async () => ({
          stream: convertArrayToReadableStream([
            { type: 'stream-start', warnings: [] },
            { type: 'reasoning-start', id: 'r0' },
            { type: 'reasoning-delta', id: 'r0', delta: '[이름' },
            { type: 'reasoning-delta', id: 'r0', delta: '_1]은 누구?' },
            { type: 'reasoning-end', id: 'r0' },
            { type: 'text-start', id: 't0' },
            { type: 'text-delta', id: 't0', delta: '네.' },
            { type: 'text-end', id: 't0' },
            { type: 'finish', finishReason: stop, usage },
          ]),
        }),
      });
      const model = wrapLanguageModel({ model: mock, middleware: piiMiddleware({ vault, restoreReasoning }) });
      const r = streamText({ model, prompt: USER_TEXT });
      expect(await r.reasoningText).toBe(restoreReasoning ? `${NAMES.lee}는 누구?` : '[이름_1]은 누구?');
    }
  });

  it('도구 호출(generate): 도구 함수는 원래 값을 받고, 다음 단계 프롬프트에는 다시 가명만 간다', async () => {
    const vault = createVault();
    const toolInput = JSON.stringify({ name: '[이름_1]', note: '[이름_1]은 VIP' });
    const mock = new MockLanguageModelV4({
      doGenerate: [
        {
          content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'lookup_customer', input: toolInput }],
          finishReason: toolCalls,
          usage,
          warnings: [],
        },
        { content: [{ type: 'text', text: '[이름_1]님 조회 완료, [전화_1]로 안내' }], finishReason: stop, usage, warnings: [] },
      ],
    });
    const model = wrapLanguageModel({ model: mock, middleware: piiMiddleware({ vault, detect: { names: [TRICKY] } }) });
    const received: Array<{ name: string; note: string }> = [];
    const r = await generateText({
      model,
      prompt: `${TRICKY} 고객(${SYN.phone1234}) 조회`,
      stopWhen: stepCountIs(2),
      tools: {
        lookup_customer: tool({
          inputSchema: jsonSchema<{ name: string; note: string }>({
            type: 'object',
            properties: { name: { type: 'string' }, note: { type: 'string' } },
            required: ['name', 'note'],
          }),
          execute: async (input) => {
            received.push(input);
            return { found: true, phone: SYN.phone1234, owner: TRICKY };
          },
        }),
      },
    });

    // 도구 인자는 원래 값으로, JSON 이 깨지지 않은 채 도착한다(따옴표·역슬래시 포함)
    expect(received).toEqual([{ name: TRICKY, note: `${TRICKY}은 VIP` }]);
    // 두 번째 모델 호출(도구 결과를 담은 프롬프트)에도 원래 값이 없다
    expect(mock.doGenerateCalls).toHaveLength(2);
    for (const call of mock.doGenerateCalls) expect(leaked(call.prompt)).toEqual([]);
    expect(r.text).toBe(`${TRICKY}님 조회 완료, ${SYN.phone1234}로 안내`);
  });

  it('도구 호출(stream): tool-input-delta 조각을 이어 붙이면 원래 값이 든 올바른 JSON 이다', async () => {
    const vault = createVault();
    const input = JSON.stringify({ name: '[이름_1]', phone: '[전화_1]' });
    const mock = new MockLanguageModelV4({
      doStream: async () => ({
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          { type: 'tool-input-start', id: 'c1', toolName: 'lookup_customer' },
          ...splitBy(input, [3, 1, 5]).map((delta) => ({ type: 'tool-input-delta' as const, id: 'c1', delta })),
          { type: 'tool-input-end', id: 'c1' },
          { type: 'tool-call', toolCallId: 'c1', toolName: 'lookup_customer', input },
          { type: 'finish', finishReason: toolCalls, usage },
        ]),
      }),
    });
    const model = wrapLanguageModel({ model: mock, middleware: piiMiddleware({ vault, detect: { names: [TRICKY] } }) });
    const received: unknown[] = [];
    const r = streamText({
      model,
      prompt: `${TRICKY} 고객(${SYN.phone1234}) 조회`,
      tools: {
        lookup_customer: tool({
          inputSchema: jsonSchema<{ name: string; phone: string }>({ type: 'object', properties: { name: { type: 'string' }, phone: { type: 'string' } } }),
          execute: async (i) => {
            received.push(i);
            return 'ok';
          },
        }),
      },
    });
    let streamedInput = '';
    for await (const part of r.fullStream) {
      if (part.type === 'tool-input-delta') {
        expect(part.delta).not.toMatch(/\[이름|\[전화/);
        streamedInput += part.delta;
      }
    }
    expect(JSON.parse(streamedInput)).toEqual({ name: TRICKY, phone: SYN.phone1234 });
    expect(received).toEqual([{ name: TRICKY, phone: SYN.phone1234 }]);
  });
});
