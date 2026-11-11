// 합성 값 생성기. 테스트·예제·README 의 번호는 모두 여기서 만든 가짜다.
//
// 실존 번호와 겹치지 않게 하는 방법:
// - 주민·외국인등록번호(체크섬 맞는 것): 생년월일을 2090년대로(아직 태어나지 않은 사람) 잡는다.
// - 1900년대 성별 자리(1·2·5·6)는 1900-01 생일 + 일부러 틀린 체크섬으로만 만든다.
// - 사업자번호: 세무서 코드 000 + 업태 코드 00 (실제로 쓰지 않는 코드)
// - 카드: 발급사 번호 0000 (배정되지 않은 범위)
// - 전화: 국번 0000 (010-0000-xxxx, 02-0000-xxxx)
// - 계좌: 000-000-00xxxx
// 체크섬 계산식은 src 의 탐지기와 일부러 따로 적었다(같은 버그를 공유하지 않도록).

const RRN_WEIGHTS = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];

function weighted(d: string): number {
  return RRN_WEIGHTS.reduce((acc, w, k) => acc + w * Number(d[k]), 0);
}

function idNumber(yymmdd: string, gender: string, mid5: string, valid: boolean, foreign: boolean): string {
  const first12 = yymmdd + gender + mid5;
  const s = weighted(first12);
  const right = foreign ? (13 - (s % 11)) % 10 : (11 - (s % 11)) % 10;
  const check = valid ? right : (right + 1) % 10;
  return `${yymmdd}-${gender}${mid5}${check}`;
}

/** 주민등록번호(합성). valid=false 면 체크섬을 일부러 틀리게(2020-10 이후 번호 흉내) */
export function makeRrn(yymmdd: string, gender: '1' | '2' | '3' | '4', mid5: string, valid: boolean): string {
  return idNumber(yymmdd, gender, mid5, valid, false);
}

/** 외국인등록번호(합성) */
export function makeFrn(yymmdd: string, gender: '5' | '6' | '7' | '8', mid5: string, valid: boolean): string {
  return idNumber(yymmdd, gender, mid5, valid, true);
}

/** 사업자등록번호(합성): 000-00-NNNNC */
export function makeBrn(serial4: string, valid: boolean): string {
  const d = `00000${serial4}`;
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let s = w.reduce((acc, x, k) => acc + x * Number(d[k]), 0);
  s += Math.floor((Number(d[8]) * 5) / 10);
  const right = (10 - (s % 10)) % 10;
  return `000-00-${serial4}${valid ? right : (right + 1) % 10}`;
}

/** 카드 번호(합성): 0 열두 개 + NNN + 체크 자리를 4자리씩 끊는다. 구분자는 '-' 또는 ' ' */
export function makeCard(last3: string, valid: boolean, sep: '-' | ' ' = '-'): string {
  const body = '0'.repeat(12) + last3;
  // Luhn: 오른쪽(체크 자리 바로 왼쪽)부터 두 배
  let sum = 0;
  for (let k = 0; k < body.length; k++) {
    let d = Number(body[body.length - 1 - k]);
    if (k % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  const right = (10 - (sum % 10)) % 10;
  const digits = body + String(valid ? right : (right + 1) % 10);
  return [digits.slice(0, 4), digits.slice(4, 8), digits.slice(8, 12), digits.slice(12)].join(sep);
}

/** 휴대전화(합성): 010-0000-NNNN */
export function makePhone(last4: string, sep: '-' | '' | '.' | ' ' = '-'): string {
  return `010${sep}0000${sep}${last4}`;
}

/** 유선전화(합성): 02-0000-NNNN */
export function makeLandline(last4: string): string {
  return `02-0000-${last4}`;
}

/**
 * 국제 표기 전화(합성): +82 + 국번(0000) + NNNN.
 * head = '+82' 뒤 구분자, sep = 국번 뒤 구분자, trunk = 앞자리 0 표기('' | '0' | '(0)').
 * 예: head '-' → +82-10-0000-NNNN, head '' + sep '' → 구분자 없이 붙여 쓴 꼴
 */
export function makePhoneIntl(
  last4: string,
  head: '-' | '' | '.' | ' ' = '-',
  sep: '-' | '' | '.' | ' ' = head,
  trunk: '' | '0' | '(0)' = '',
): string {
  return `+82${head}${trunk}10${sep}0000${sep}${last4}`;
}

/** 국제 표기 유선(합성): +82-<area>-0000-NNNN. area 는 '2'·'31'·'70' 등(앞자리 0 없음) */
export function makeLandlineIntl(area: string, last4: string, sep: '-' | '.' | ' ' = '-'): string {
  return `+82${sep}${area}${sep}0000${sep}${last4}`;
}

/** 계좌 번호(합성): 000-000-00NNNN */
export function makeAccount(last4: string): string {
  return `000-000-00${last4}`;
}

/** 13자리 주문번호(합성, 음성 사례): 20261110NNNNN — 앞 6자리가 날짜로 불가능(26월) */
export function makeOrderNo(serial5: string): string {
  return `20261110${serial5}`;
}

// ---- 테스트에서 쓰는 고정 값 ----
export const SYN = {
  // 주민등록번호
  rrnChecksumMale: makeRrn('990101', '3', '00001', true), // 2099-01-01, 체크섬 맞음 → checksum
  rrnChecksumFemale: makeRrn('980228', '4', '00002', true),
  rrnLeapDay: makeRrn('960229', '3', '00006', true), // 2096 윤년 2/29 → 가능
  rrnAfter2020: makeRrn('970315', '3', '40404', false), // 체크섬 틀림 → format
  rrn1900Format: makeRrn('000101', '1', '00003', false), // 1900년대 성별 자리 1, 체크섬 틀림 → format
  rrnImpossibleDate: makeRrn('991399', '3', '00005', true), // 13월 99일 → 음성
  rrnNotLeap: makeRrn('000229', '1', '00007', false), // 1900-02-29 → 음성(1900년은 평년)
  // 외국인등록번호
  frnChecksum7: makeFrn('990101', '7', '00001', true),
  frnChecksum8: makeFrn('960707', '8', '00002', true),
  frn5Format: makeFrn('000102', '5', '00003', false),
  frn6Format: makeFrn('000103', '6', '00004', false),
  // 사업자등록번호
  brn: makeBrn('0001', true),
  brn2: makeBrn('0420', true),
  brnBad: makeBrn('0001', false),
  // 카드
  card: makeCard('001', true),
  cardSpaced: makeCard('002', true, ' '),
  cardBad: makeCard('001', false),
  // 전화
  phone1234: makePhone('1234'),
  phone5678: makePhone('5678'),
  phone0000: makePhone('0000'),
  phonePlain: makePhone('3333', ''),
  landline: makeLandline('1234'),
  phoneIntl: makePhoneIntl('1234'),
  // 계좌
  account: makeAccount('1234'),
  account2: makeAccount('5670'),
  // 음성 사례
  orderNo: makeOrderNo('00001'),
  // 이메일·이름(번호가 아니라 hygiene 대상은 아님)
  email: 'gamyeong.kim@example.com',
  email2: 'sample+test@example.org',
} as const;

/** 가짜 이름(실존 인물과 무관한 낱말 조합) */
export const NAMES = {
  kim: '김가명',
  lee: '이예시',
  park: '박샘플',
  choi: '최더미',
  compound: '남궁가상',
  twoChar: '조연',
} as const;

/** 레포 안에 나와도 되는 번호 모양 문자열인지 */
export function isSyntheticNumber(s: string): boolean {
  const values = Object.values(SYN) as string[];
  const fixed = new Set<string>([
    ...values,
    ...values.filter((v) => /^\d{6}-\d{7}$/.test(v)).map((v) => v.replace('-', '')), // 하이픈 없는 주민번호 꼴
    ...values.filter((v) => /^\d{3}-\d{2}-\d{5}$/.test(v)).map((v) => v.replace(/-/g, '')), // 하이픈 없는 사업자번호
    ...values.filter((v) => /^\d{4}([- ])\d{4}\1\d{4}\1\d{4}$/.test(v)).map((v) => v.replace(/[- ]/g, '')), // 붙여 쓴 카드
  ]);
  if (fixed.has(s)) return true;
  // 국번 0000 전화는 끝 4자리가 무엇이든 합성
  // 국제 표기: 검사기가 '+' 를 떼고 뽑으므로 82 접두·앞자리 0 생략 꼴(10…)의 국번 0000 휴대, 02 유선까지만 허용
  if (/^82[-. ]?10([-. ]?)0000\1\d{4}$/.test(s) || /^10([-. ]?)0000\1\d{4}$/.test(s) || /^82[-. ]?2([-. ])0000\1\d{4}$/.test(s)) return true;
  return /^010([-. ]?)0000\1\d{4}$/.test(s) || /^02([-. ])0000\1\d{4}$/.test(s) || /^000-000-00\d{4}$/.test(s);
}
