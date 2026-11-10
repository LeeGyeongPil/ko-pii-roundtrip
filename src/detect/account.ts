// 계좌 번호: 은행마다 자릿수·모양이 달라 숫자만으로는 알 수 없다.
// 그래서 은행 이름이 바로 앞(같은 줄, 20글자 안)에 있을 때만 계좌로 본다(문맥 필수).

import type { Detection, Detector } from '../types';

// '우리'·'하나'·'부산'처럼 흔한 낱말과 겹치는 이름은 '은행'까지 붙어야 은행으로 본다
const BANK =
  /(카카오뱅크|케이뱅크|토스뱅크|iM뱅크|새마을금고|우체국|신협|(?:KB|NH|IBK|SC|KDB|BNK|DGB)?\s?(?:국민|신한|우리|하나|기업|제일|씨티|한국씨티|농협|수협|대구|부산|경남|광주|전북|제주|산업)은행|NH농협|농협)/g;

// 숫자 묶음을 하이픈으로 이은 꼴(합쳐 10~16자리) 또는 붙여 쓴 10~14자리
const NUMBER = /(?<![\d-])(?:\d{2,6}(?:-\d{2,7}){1,4}|\d{10,14})(?![\d-]?\d)/g;
const WINDOW = 20;

export const accountDetector: Detector = {
  kind: 'account',
  label: '계좌',
  find(text: string): Detection[] {
    const found: Detection[] = [];
    for (const bank of text.matchAll(BANK)) {
      const from = bank.index + bank[0].length;
      const window = text.slice(from, from + WINDOW);
      const lineEnd = window.indexOf('\n');
      const scope = lineEnd === -1 ? window : window.slice(0, lineEnd);
      // 창 안의 첫 번호 하나만 본다. 창 경계에서 번호가 잘리지 않도록 원문에서 다시 맞춘다.
      NUMBER.lastIndex = from;
      const m = NUMBER.exec(text);
      if (m === null || m.index >= from + scope.length) continue;
      const digits = m[0].replace(/-/g, '').length;
      if (digits < 10 || digits > 16) continue;
      found.push({ kind: 'account', value: m[0], start: m.index, end: m.index + m[0].length, confidence: 'context' });
    }
    return found;
  },
};
