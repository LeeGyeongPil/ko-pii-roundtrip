// ESM 소비자: 설치된 tarball 을 import 로 불러 왕복 실행한다(연습용 목 모델·가짜 fetch).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createVault, detect, pseudonymize, restore } from 'ko-pii-roundtrip';
import { piiMiddleware } from 'ko-pii-roundtrip/ai-sdk';
import { wrapOpenAI } from 'ko-pii-roundtrip/openai';
import { streamText, wrapLanguageModel } from 'ai';
import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test';
import OpenAI from 'openai';

const USER = '고객 이예시님(010-0000-1234)이 환불 요청';
const ANSWER = '[이름_1]은 [전화_1]으로 연락하세요.';
const EXPECTED = '이예시는 010-0000-1234로 연락하세요.';
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

// 1) 코어 왕복
const vault = createVault();
assert.equal(detect(USER).length, 2);
const sent = pseudonymize(USER, vault);
assert.equal(sent, '고객 [이름_1]님([전화_1])이 환불 요청');
assert.equal(restore(sent, vault), USER);

// 2) AI SDK 미들웨어 + streamText
const mock = new MockLanguageModelV4({
  doStream: async () => ({
    stream: convertArrayToReadableStream([
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 't' },
      ...ANSWER.match(/.{1,3}/gsu).map((delta) => ({ type: 'text-delta', id: 't', delta })),
      { type: 'text-end', id: 't' },
      { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
    ]),
  }),
});
const model = wrapLanguageModel({ model: mock, middleware: piiMiddleware({ vault: createVault() }) });
const streamed = await streamText({ model, prompt: USER }).text;
assert.equal(streamed, EXPECTED);
assert.ok(!JSON.stringify(mock.doStreamCalls[0].prompt).includes('010-0000-1234'));

// 3) openai 래퍼(가짜 fetch)
let body = '';
const fakeFetch = async (_url, init) => {
  body = String(init.body);
  return new Response(
    JSON.stringify({ id: 'x', object: 'chat.completion', created: 0, model: 'm', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: ANSWER } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
};
const client = wrapOpenAI(new OpenAI({ apiKey: 'mock', baseURL: 'http://mock.invalid/v1', fetch: fakeFetch, maxRetries: 0 }), { vault: createVault() });
const res = await client.chat.completions.create({ model: 'm', messages: [{ role: 'user', content: USER }] });
assert.equal(res.choices[0].message.content, EXPECTED);
assert.ok(!body.includes('이예시'));

// 4) 이중 패키지: ESM 으로 만든 vault 를 CJS 빌드 함수에 넘겨도 다음 턴 일관성이 유지된다
//    ('이예시는 확인'에는 호칭이 없어 탐지기만으로는 못 찾고, vault 가 아는 값으로만 찾는다)
const require = createRequire(import.meta.url);
const cjsCore = require('ko-pii-roundtrip');
const shown = restore('[이름_1]은 확인', vault);
assert.equal(shown, '이예시는 확인');
assert.equal(cjsCore.pseudonymize(shown, vault), '[이름_1]는 확인');

console.log(`CONSUMER_ESM_OK node=${process.version}`);
