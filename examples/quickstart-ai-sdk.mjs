// Vercel AI SDK 미들웨어 예제 — 연습용 목(mock) 모델이라 키·네트워크가 필요 없다.
// 실제 모델을 쓰려면 `model: mock` 자리에 provider 의 모델(예: openai('...'))을 넣는다.
import { streamText, wrapLanguageModel } from 'ai';
import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test';
import { createVault } from 'ko-pii-roundtrip';
import { piiMiddleware } from 'ko-pii-roundtrip/ai-sdk';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
// 목 모델: 가명이 조각 사이에서 쪼개지도록 일부러 잘게 나눠 흘린다
const pieces = ['[이름', '_1]', '은 [전', '화_1]으', '로 연락', '드립니다.'];
const mock = new MockLanguageModelV4({
  doStream: async () => ({
    stream: convertArrayToReadableStream([
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 't0' },
      ...pieces.map((delta) => ({ type: 'text-delta', id: 't0', delta })),
      { type: 'text-end', id: 't0' },
      { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
    ]),
  }),
});

const vault = createVault();
const model = wrapLanguageModel({ model: mock, middleware: piiMiddleware({ vault }) });

const result = streamText({ model, prompt: '고객 이예시님(010-0000-1234)이 환불을 요청했습니다.' });
const shown = [];
for await (const delta of result.textStream) shown.push(delta);

console.log('모델이 받은 글:', mock.doStreamCalls[0].prompt.at(-1).content[0].text);
console.log('화면에 나간 조각:', JSON.stringify(shown));
console.log('이어 붙인 글:', shown.join(''));
