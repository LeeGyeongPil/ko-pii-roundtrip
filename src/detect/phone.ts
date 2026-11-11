// 전화번호: 휴대(010·011·016·017·018·019)와 유선(지역번호 02·031~064, 인터넷전화 070).
// 구분자는 하이픈·점·공백 중 하나를 일관되게 쓴 꼴만 본다. 휴대는 구분자 없는 꼴도 본다.
// '+82' 국제 표기도 본다: '+82' 뒤 구분자(없어도 됨), 선택적 '(0)'·'0', 국내와 같은 국번 규칙.

import type { Detection, Detector } from '../types';

// \2 는 첫 구분자와 같은 구분자를 요구한다(하이픈과 공백이 섞인 꼴은 제외)
const MOBILE = /(?<![\d-])(01[016789])([-. ]?)(\d{3,4})\2(\d{4})(?![\d-]?\d)/g;
const LANDLINE = /(?<![\d-])(02|0[3-6][1-5]|070)([-. ])(\d{3,4})\2(\d{4})(?![\d-]?\d)/g;

// 국제 표기. 앞의 '+' 는 (?<![\w+]) 로 막아 다른 글자에 붙은 꼴을 제외하고, 겹치면 긴 쪽(국제 표기 전체)이 이긴다
const INTL_MOBILE = /(?<![\w+])\+82[-. ]?(?:\(0\)|0)?(1[016789])([-. ]?)(\d{3,4})\2(\d{4})(?![\d-]?\d)/g;
const INTL_LANDLINE = /(?<![\w+])\+82[-. ]?(?:\(0\)|0)?(2|[3-6][1-5]|70)([-. ])(\d{3,4})\2(\d{4})(?![\d-]?\d)/g;

export const phoneDetector: Detector = {
  kind: 'phone',
  label: '전화',
  find(text: string): Detection[] {
    const found: Detection[] = [];
    for (const re of [MOBILE, LANDLINE, INTL_MOBILE, INTL_LANDLINE]) {
      for (const m of text.matchAll(re)) {
        found.push({ kind: 'phone', value: m[0], start: m.index, end: m.index + m[0].length, confidence: 'format' });
      }
    }
    return found;
  },
};
