// openai 클라이언트 래퍼 예제 — 가짜 fetch 로 스트리밍 응답을 흉내 낸다(키·네트워크 불필요).
// 실제로는 `fetch`·`baseURL`·`apiKey` 를 넘기지 않고 `new OpenAI()` 를 그대로 쓴다.
import OpenAI from 'openai';
import { createVault } from 'ko-pii-roundtrip';
import { wrapOpenAI } from 'ko-pii-roundtrip/openai';

const pieces = ['[이름', '_1]', '은 [전', '화_1]으', '로 연락', '드립니다.'];
let requestBody = '';
const fakeFetch = async (_url, init) => {
  requestBody = String(init.body);
  const chunk = (delta, finish = null) =>
    `data: ${JSON.stringify({
      id: 'x', object: 'chat.completion.chunk', created: 0, model: 'mock',
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;
  const body = [
    chunk({ role: 'assistant' }),
    ...pieces.map((p) => chunk({ content: p })),
    chunk({}, 'stop'),
    'data: [DONE]\n\n',
  ].join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
};

const client = wrapOpenAI(
  new OpenAI({ apiKey: 'mock', baseURL: 'http://mock.invalid/v1', fetch: fakeFetch, maxRetries: 0 }),
  { vault: createVault() },
);

const stream = await client.chat.completions.create({
  model: 'mock',
  stream: true,
  messages: [{ role: 'user', content: '고객 이예시님(010-0000-1234)이 환불을 요청했습니다.' }],
});
let shown = '';
for await (const chunk of stream) shown += chunk.choices[0]?.delta?.content ?? '';

console.log('서버가 받은 요청:', JSON.parse(requestBody).messages[0].content);
console.log('복원된 답:', shown);
