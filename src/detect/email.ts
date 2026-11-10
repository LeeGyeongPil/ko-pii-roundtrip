// 이메일 주소. 흔한 꼴만(로컬부@도메인.최상위) 본다.

import type { Detection, Detector } from '../types';

const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![A-Za-z0-9-])/g;

export const emailDetector: Detector = {
  kind: 'email',
  label: '이메일',
  find(text: string): Detection[] {
    const found: Detection[] = [];
    for (const m of text.matchAll(EMAIL)) {
      found.push({ kind: 'email', value: m[0], start: m.index, end: m.index + m[0].length, confidence: 'format' });
    }
    return found;
  },
};
