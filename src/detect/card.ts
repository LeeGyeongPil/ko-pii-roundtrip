// 카드 번호: 4-4-4-4(16자리) 또는 4-6-5(15자리), Luhn 체크섬이 맞아야 한다.
// 구분자 없는 15~16자리는 '카드' 문맥이 앞에 있을 때만 본다.

import type { Detection, Detector } from '../types';

export function luhnOk(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let k = digits.length - 1; k >= 0; k--) {
    let d = Number(digits[k]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const GROUPED_16 = /(?<![\d-])\d{4}([- ])\d{4}\1\d{4}\1\d{4}(?![\d-]?\d)/g;
const GROUPED_15 = /(?<![\d-])\d{4}([- ])\d{6}\1\d{5}(?![\d-]?\d)/g;
const PLAIN = /(?<![\d-])\d{15,16}(?![\d-]?\d)/g;
const CONTEXT_BEFORE = /카드[^\n]{0,12}$/;

export const cardDetector: Detector = {
  kind: 'card',
  label: '카드',
  find(text: string): Detection[] {
    const found: Detection[] = [];
    for (const re of [GROUPED_16, GROUPED_15]) {
      for (const m of text.matchAll(re)) {
        if (!luhnOk(m[0].replace(/[- ]/g, ''))) continue;
        found.push({ kind: 'card', value: m[0], start: m.index, end: m.index + m[0].length, confidence: 'checksum' });
      }
    }
    for (const m of text.matchAll(PLAIN)) {
      if (!luhnOk(m[0]) || !CONTEXT_BEFORE.test(text.slice(0, m.index))) continue;
      found.push({ kind: 'card', value: m[0], start: m.index, end: m.index + m[0].length, confidence: 'checksum' });
    }
    return found;
  },
};
