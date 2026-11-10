// 주민등록번호(rrn)·외국인등록번호(frn): YYMMDD-GNNNNNN
//
// - 앞 6자리는 달력에 있는 날짜여야 한다(윤년 포함). "오늘"과는 비교하지 않는다.
// - 성별 자리 G: 1·2(1900년대)·3·4(2000년대) = 주민, 5·6(1900년대)·7·8(2000년대) = 외국인
// - 마지막 자리 체크섬은 2020-10 이전에 부여된 번호만 맞는다. 그 뒤 번호는 뒷자리가 임의라
//   체크섬이 틀려도 진짜일 수 있으므로 거절하지 않고 confidence 만 낮춘다(checksum → format).

import type { Detection, Detector } from '../types';

const WEIGHTS = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];

function weightedSum(d: string): number {
  let s = 0;
  for (let k = 0; k < 12; k++) s += (WEIGHTS[k] as number) * Number(d[k]);
  return s;
}

/** 주민등록번호 체크섬(2020-10 이전 부여분) */
export function rrnChecksumOk(digits13: string): boolean {
  return (11 - (weightedSum(digits13) % 11)) % 10 === Number(digits13[12]);
}

/** 외국인등록번호 체크섬(2020-10 이전 부여분) */
export function frnChecksumOk(digits13: string): boolean {
  return (13 - (weightedSum(digits13) % 11)) % 10 === Number(digits13[12]);
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** 달력 규칙만으로 날짜가 가능한지 본다 */
export function isValidDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const max = month === 2 && isLeap(year) ? 29 : (DAYS[month - 1] as number);
  return day <= max;
}

// 하이픈 있는 꼴과 없는 꼴. 앞뒤에 숫자가 붙어 있으면(더 긴 숫자열의 일부) 보지 않는다.
const PATTERN = /(?<![\d-])(\d{6})(-?)([1-8])(\d{6})(?![\d-]?\d)/g;
// 하이픈 없는 13자리는 주문번호 같은 숫자열과 헷갈리므로, 체크섬이 맞거나 앞에 문맥 낱말이 있을 때만
const CONTEXT_BEFORE = /(주민|등록번호|외국인)[^\n]{0,12}$/;

function findIdNumbers(text: string, want: 'rrn' | 'frn'): Detection[] {
  const found: Detection[] = [];
  for (const m of text.matchAll(PATTERN)) {
    const [whole, front, hyphen, g, back] = m as unknown as [string, string, string, string, string];
    const gender = Number(g);
    const isForeign = gender >= 5;
    if ((want === 'frn') !== isForeign) continue;

    const century = gender <= 2 || gender === 5 || gender === 6 ? 1900 : 2000;
    const year = century + Number(front.slice(0, 2));
    if (!isValidDate(year, Number(front.slice(2, 4)), Number(front.slice(4, 6)))) continue;

    const digits = front + g + back;
    const checksum = isForeign ? frnChecksumOk(digits) : rrnChecksumOk(digits);
    if (hyphen === '' && !checksum && !CONTEXT_BEFORE.test(text.slice(0, m.index))) continue;

    found.push({
      kind: want,
      value: whole,
      start: m.index,
      end: m.index + whole.length,
      confidence: checksum ? 'checksum' : 'format',
    });
  }
  return found;
}

export const rrnDetector: Detector = {
  kind: 'rrn',
  label: '주민번호',
  find: (text) => findIdNumbers(text, 'rrn'),
};

export const frnDetector: Detector = {
  kind: 'frn',
  label: '외국인번호',
  find: (text) => findIdNumbers(text, 'frn'),
};
