// 사업자등록번호: NNN-NN-NNNNN, 가중치 1,3,7,1,3,7,1,3,5 체크섬이 맞아야 한다.
// 하이픈 없는 10자리는 전화번호 등과 헷갈리므로 '사업자' 문맥이 앞에 있을 때만 본다.

import type { Detection, Detector } from '../types';

const WEIGHTS = [1, 3, 7, 1, 3, 7, 1, 3, 5];

export function brnChecksumOk(digits10: string): boolean {
  let s = 0;
  for (let k = 0; k < 9; k++) s += (WEIGHTS[k] as number) * Number(digits10[k]);
  s += Math.floor((5 * Number(digits10[8])) / 10); // 9번째 자리×5 의 십의 자리를 한 번 더 더한다
  return (10 - (s % 10)) % 10 === Number(digits10[9]);
}

const HYPHENATED = /(?<![\d-])\d{3}-\d{2}-\d{5}(?![\d-]?\d)/g;
const PLAIN = /(?<![\d-])\d{10}(?![\d-]?\d)/g;
const CONTEXT_BEFORE = /사업자[^\n]{0,12}$/;

export const brnDetector: Detector = {
  kind: 'brn',
  label: '사업자번호',
  find(text: string): Detection[] {
    const found: Detection[] = [];
    for (const m of text.matchAll(HYPHENATED)) {
      if (!brnChecksumOk(m[0].replace(/-/g, ''))) continue;
      found.push({ kind: 'brn', value: m[0], start: m.index, end: m.index + m[0].length, confidence: 'checksum' });
    }
    for (const m of text.matchAll(PLAIN)) {
      if (!brnChecksumOk(m[0]) || !CONTEXT_BEFORE.test(text.slice(0, m.index))) continue;
      found.push({ kind: 'brn', value: m[0], start: m.index, end: m.index + m[0].length, confidence: 'checksum' });
    }
    return found;
  },
};
