// CJS 소비자: require 로 불러 왕복 실행한다. 'ai' 는 ESM 전용이라 Node 22.12+ 의 require(esm) 으로 불러온다.
const assert = require('node:assert/strict');
const { createVault, detect, pseudonymize, restore, createStreamRestorer } = require('ko-pii-roundtrip');
const { piiMiddleware } = require('ko-pii-roundtrip/ai-sdk');
const { wrapOpenAI } = require('ko-pii-roundtrip/openai');
const { streamText, wrapLanguageModel } = require('ai');
const { convertArrayToReadableStream, MockLanguageModelV4 } = require('ai/test');
const OpenAI = require('openai').default;

const USER = '고객 이예시님(010-0000-1234)이 환불 요청';
const ANSWER = '[이름_1]은 [전화_1]으로 연락하세요.';
const EXPECTED = '이예시는 010-0000-1234로 연락하세요.';
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

async function main() {
  // 1) 코어 왕복 + 스트리밍 복원기
  const vault = createVault();
  assert.equal(detect(USER).length, 2);
  const sent = pseudonymize(USER, vault);
  assert.equal(restore(sent, vault), USER);
  const r = createStreamRestorer(vault);
  const out = [...ANSWER].map((ch) => r.push(ch)).join('') + r.flush();
  assert.equal(out, EXPECTED);

  // 2) AI SDK 미들웨어 + streamText (require(esm) 으로 불러온 ai)
  const mock = new MockLanguageModelV4({
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 't' },
        ...ANSWER.match(/.{1,2}/gsu).map((delta) => ({ type: 'text-delta', id: 't', delta })),
        { type: 'text-end', id: 't' },
        { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
      ]),
    }),
  });
  const model = wrapLanguageModel({ model: mock, middleware: piiMiddleware({ vault: createVault() }) });
  assert.equal(await streamText({ model, prompt: USER }).text, EXPECTED);

  // 3) openai 래퍼(가짜 fetch, 스트리밍)
  const enc = new TextEncoder();
  const fakeFetch = async () =>
    new Response(
      new ReadableStream({
        start(c) {
          for (const p of ANSWER.match(/.{1,4}/gsu)) {
            c.enqueue(enc.encode(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: { content: p }, finish_reason: null }] })}\n\n`));
          }
          c.enqueue(enc.encode('data: [DONE]\n\n'));
          c.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );
  const client = wrapOpenAI(new OpenAI({ apiKey: 'mock', baseURL: 'http://mock.invalid/v1', fetch: fakeFetch, maxRetries: 0 }), { vault: createVault() });
  const stream = await client.chat.completions.create({ model: 'm', messages: [{ role: 'user', content: USER }], stream: true });
  let text = '';
  for await (const ch of stream) text += ch.choices[0]?.delta?.content ?? '';
  assert.equal(text, EXPECTED);

  console.log(`CONSUMER_CJS_OK node=${process.version}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
