// 연습용 목(mock) 데모 — 실제 LLM 을 부르지 않는다. 네트워크·키가 필요 없다.
//
// 보여 주는 것
//   1. 모델에 실제로 나가는 글: 개인정보가 가명([이름_1] 등)으로 바뀌어 있다(LEAK 0).
//   2. 목 모델의 답: 가명을 인용하고, 가명 번호 '1(일)'에 맞춘 조사(은·으로)를 붙인다.
//      이 답을 고정 시드 난수로 1~6글자 조각으로 쪼개 흘린다(스트리밍 흉내).
//   3. 조각마다 따로 바꾸는 단순 치환은 가명 조각이 새고 조사가 틀린다(NAIVE_BROKEN yes).
//   4. 보류 버퍼 복원(이 라이브러리)은 조각이 어떻게 쪼개져도 같은 결과를 낸다(SPLITS 200/200).
//
// 실행: npm run example   (먼저 빌드한 뒤 이 파일을 실행한다)

import { streamText, wrapLanguageModel } from 'ai';
import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test';
import { createVault, restore } from 'ko-pii-roundtrip';
import { piiMiddleware } from 'ko-pii-roundtrip/ai-sdk';

// 모두 합성 값(가짜 이름, 국번 0000 전화)
const USER = '고객 이예시님(010-0000-1234)이 환불을 요청했습니다. 담당자 김가명 과장에게 연결해 주세요.';
const ORIGINALS = ['이예시', '010-0000-1234', '김가명'];

// 목 모델이 쓰는 답. 실제 모델도 가명 뒤 조사를 '[이름_1]'의 '1(일)' 소리에 맞춰 붙이곤 한다.
const MODEL_ANSWER = '[이름_1]은 [전화_1]으로 연락드리겠습니다. [이름_1]을 [이름_2]과 연결했습니다.';
const EXPECTED = '이예시는 010-0000-1234로 연락드리겠습니다. 이예시를 김가명과 연결했습니다.';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

/** 고정 시드 난수(mulberry32). 같은 시드면 매번 같은 조각이 나온다 */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

/** 글을 1~6글자 조각으로 쪼갠다 */
function split(text, rnd) {
  const parts = [];
  for (let i = 0; i < text.length; ) {
    const n = 1 + Math.floor(rnd() * 6);
    parts.push(text.slice(i, i + n));
    i += n;
  }
  return parts;
}

/** 조각을 그대로 흘려보내는 목 모델 */
function mockModel(parts) {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 't0' },
        ...parts.map((delta) => ({ type: 'text-delta', id: 't0', delta })),
        { type: 'text-end', id: 't0' },
        { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
      ]),
    }),
  });
}

/** 미들웨어를 끼운 모델로 streamText 를 돌려, 화면에 나갈 조각들과 모델이 받은 프롬프트를 돌려준다 */
async function runOnce(parts) {
  const vault = createVault(); // 대화 하나당 vault 하나
  const mock = mockModel(parts);
  const model = wrapLanguageModel({ model: mock, middleware: piiMiddleware({ vault }) });
  const result = streamText({ model, prompt: USER });
  const shown = [];
  for await (const delta of result.textStream) shown.push(delta);
  const sentText = mock.doStreamCalls[0].prompt.at(-1).content[0].text;
  return { vault, shown, sentText, sentJson: JSON.stringify(mock.doStreamCalls[0].prompt) };
}

/** 비교용: 조각마다 따로 가명을 원래 값으로 바꾸는 단순한 방법(이렇게 하면 안 된다) */
function naiveRestore(parts, vault) {
  return parts.map((p) => vault.tokens().reduce((s, t) => s.split(t).join(vault.original(t)), p)).join('');
}

console.log('=== ko-pii-roundtrip 데모 — 연습용 목(mock) 모드: 실제 LLM 이 아닙니다 ===\n');

// ---- 1. 한 번 돌려 보기 ----
const rnd = random(20261110);
const firstParts = split(MODEL_ANSWER, rnd);
const first = await runOnce(firstParts);
const leaks = ORIGINALS.filter((v) => first.sentJson.includes(v)).length;

console.log('[원문]            ', USER);
console.log('[모델에 보낸 글]  ', first.sentText);
console.log(`LEAK ${leaks}   (모델 쪽으로 나간 원래 값 개수)\n`);

console.log('[목 모델 답(가명)]', MODEL_ANSWER);
console.log('[흘러온 조각]     ', firstParts.map((p) => JSON.stringify(p)).join(' '), '\n');

const naive = naiveRestore(firstParts, first.vault);
const naiveBroken = naive !== EXPECTED;
console.log('[단순 치환]       ', naive);
console.log(`NAIVE_BROKEN ${naiveBroken ? 'yes' : 'no'}   (조각마다 따로 바꾸면 쪼개진 가명이 그대로 화면에 샌다)`);
console.log('[조사 교정 없이]  ', restore(MODEL_ANSWER, first.vault, { josa: false }), '  ← 다 모아 바꿔도 조사가 틀린다\n');

const restored = first.shown.join('');
console.log('[보류 버퍼 복원]  ', restored);
console.log('[화면에 나간 조각]', first.shown.map((p) => JSON.stringify(p)).join(' '));
console.log(`MATCH ${restored === EXPECTED ? 'yes' : 'no'}\n`);

// ---- 2. 200가지로 쪼개 보기 ----
let same = 0;
let leakTotal = 0;
for (let k = 0; k < 200; k++) {
  const run = await runOnce(split(MODEL_ANSWER, rnd));
  if (run.shown.join('') === EXPECTED) same += 1;
  leakTotal += ORIGINALS.filter((v) => run.sentJson.includes(v)).length;
}
console.log(`SPLITS ${same}/200   (고정 시드 20261110 으로 200가지 다르게 쪼갠 스트림의 복원 결과가 모두 같은지)`);
console.log(`LEAK_TOTAL ${leakTotal}`);

const ok = leaks === 0 && leakTotal === 0 && naiveBroken && restored === EXPECTED && same === 200;
process.exit(ok ? 0 : 1);
