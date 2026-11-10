// 받침 판정과 조사 고르기 예제 — 네트워크 불필요
import { attachJosa, hasBatchim } from 'ko-pii-roundtrip';

const cases = [
  ['이예시', '은/는'],
  ['김가명', '은/는'],
  ['서울', '으로/로'],
  ['010-0000-5678', '으로/로'],
  ['010-0000-1234', '과/와'],
  ['gamyeong.kim@example.com', '이/가'],
];
for (const [word, pair] of cases) console.log(`${word} + ${pair} -> ${attachJosa(word, pair)}  (받침: ${hasBatchim(word)})`);
