// AC-1: 한국형 식별번호 탐지 — 합성 양성 세트는 전부 맞는 kind·신뢰도로, 음성 세트는 0건.

import { describe, expect, it } from 'vitest';
import { createVault, detect, detectors, KoPiiError, pseudonymize, UnknownDetectorError, type Detector } from '../src/index';
import { NAMES, SYN } from './fixtures/synthetic';

interface Positive {
  text: string;
  kind: string;
  value: string;
  confidence: 'checksum' | 'format' | 'context';
}

const POSITIVES: Positive[] = [
  // 주민등록번호: 체크섬 맞음 → checksum, 틀림(2020-10 이후형) → format
  { text: `주민번호 ${SYN.rrnChecksumMale} 확인`, kind: 'rrn', value: SYN.rrnChecksumMale, confidence: 'checksum' },
  { text: `(${SYN.rrnChecksumFemale})`, kind: 'rrn', value: SYN.rrnChecksumFemale, confidence: 'checksum' },
  { text: `생일이 2/29인 ${SYN.rrnLeapDay}`, kind: 'rrn', value: SYN.rrnLeapDay, confidence: 'checksum' },
  { text: `신규 번호 ${SYN.rrnAfter2020}입니다`, kind: 'rrn', value: SYN.rrnAfter2020, confidence: 'format' },
  { text: `등록번호:${SYN.rrn1900Format}`, kind: 'rrn', value: SYN.rrn1900Format, confidence: 'format' },
  // 하이픈 없는 13자리: 체크섬이 맞거나 앞에 '주민' 문맥이 있으면
  { text: `번호 ${SYN.rrnChecksumMale.replace('-', '')} 입력`, kind: 'rrn', value: SYN.rrnChecksumMale.replace('-', ''), confidence: 'checksum' },
  { text: `주민등록번호 ${SYN.rrnAfter2020.replace('-', '')}`, kind: 'rrn', value: SYN.rrnAfter2020.replace('-', ''), confidence: 'format' },
  // 외국인등록번호: 성별 자리 5~8
  { text: `외국인 ${SYN.frnChecksum7}`, kind: 'frn', value: SYN.frnChecksum7, confidence: 'checksum' },
  { text: `${SYN.frnChecksum8} 님`, kind: 'frn', value: SYN.frnChecksum8, confidence: 'checksum' },
  { text: `번호 ${SYN.frn5Format}`, kind: 'frn', value: SYN.frn5Format, confidence: 'format' },
  { text: `번호 ${SYN.frn6Format}`, kind: 'frn', value: SYN.frn6Format, confidence: 'format' },
  // 사업자등록번호: 체크섬 필수
  { text: `사업자 ${SYN.brn} 확인`, kind: 'brn', value: SYN.brn, confidence: 'checksum' },
  { text: `등록번호 ${SYN.brn2}.`, kind: 'brn', value: SYN.brn2, confidence: 'checksum' },
  { text: `사업자등록번호 ${SYN.brn.replace(/-/g, '')}`, kind: 'brn', value: SYN.brn.replace(/-/g, ''), confidence: 'checksum' },
  // 카드: Luhn
  { text: `카드 ${SYN.card} 결제`, kind: 'card', value: SYN.card, confidence: 'checksum' },
  { text: `${SYN.cardSpaced}`, kind: 'card', value: SYN.cardSpaced, confidence: 'checksum' },
  { text: `카드번호 ${SYN.card.replace(/-/g, '')}`, kind: 'card', value: SYN.card.replace(/-/g, ''), confidence: 'checksum' },
  // 전화: 휴대·유선
  { text: `연락처 ${SYN.phone1234}로`, kind: 'phone', value: SYN.phone1234, confidence: 'format' },
  { text: `휴대폰${SYN.phonePlain}`, kind: 'phone', value: SYN.phonePlain, confidence: 'format' },
  { text: `대표번호 ${SYN.landline}`, kind: 'phone', value: SYN.landline, confidence: 'format' },
  // 계좌: 은행명 문맥
  { text: `국민은행 ${SYN.account}로 입금`, kind: 'account', value: SYN.account, confidence: 'context' },
  { text: `카카오뱅크 계좌 ${SYN.account2}`, kind: 'account', value: SYN.account2, confidence: 'context' },
  { text: `우리은행(예금주 본인) ${SYN.account}`, kind: 'account', value: SYN.account, confidence: 'context' },
  // 이메일
  { text: `메일 ${SYN.email}로 회신`, kind: 'email', value: SYN.email, confidence: 'format' },
  { text: `<${SYN.email2}>`, kind: 'email', value: SYN.email2, confidence: 'format' },
  // 이름: 호칭·직함
  { text: `${NAMES.lee}님이 환불을 요청`, kind: 'name', value: NAMES.lee, confidence: 'context' },
  { text: `${NAMES.kim}고객님께 안내`, kind: 'name', value: NAMES.kim, confidence: 'context' },
  { text: `담당 ${NAMES.park} 과장`, kind: 'name', value: NAMES.park, confidence: 'context' },
  { text: `${NAMES.choi}씨가 왔다`, kind: 'name', value: NAMES.choi, confidence: 'context' },
  { text: `${NAMES.compound}님`, kind: 'name', value: NAMES.compound, confidence: 'context' },
  { text: `${NAMES.twoChar}님 안녕하세요`, kind: 'name', value: NAMES.twoChar, confidence: 'context' },
  // 이름: 앞 문맥 낱말
  { text: `고객 ${NAMES.lee}가 전화함`, kind: 'name', value: NAMES.lee, confidence: 'context' },
  { text: `성명: ${NAMES.kim}`, kind: 'name', value: NAMES.kim, confidence: 'context' },
  { text: `예금주 ${NAMES.park}, 확인 완료`, kind: 'name', value: NAMES.park, confidence: 'context' },
];

const NEGATIVES: string[] = [
  '접수일 20261110 처리',
  `주문번호 ${SYN.orderNo} 배송 시작`,
  `불가능한 날짜 ${SYN.rrnImpossibleDate}`,
  `평년 2/29 ${SYN.rrnNotLeap}`,
  `번호 ${SYN.rrnAfter2020.replace('-', '')} 입력`, // 하이픈 없음 + 체크섬 틀림 + 문맥 없음
  `사업자 ${SYN.brnBad}`,
  `카드 ${SYN.cardBad}`,
  `참조번호 ${SYN.account} 확인`, // 은행 문맥 없는 숫자열
  `우리 집 ${SYN.account}`, // '우리'만으로는 은행이 아님
  '정상 처리되었습니다. 이번 주 안에 한국 고객님께 연락드립니다.',
  '고객님, 고객 문의를 접수했습니다. 고객 정보가 변경되었습니다.',
  '선생님과 부장님, 이사님께 보고. 간호사님이 진행자님께 전달.',
  '박사님께 여쭤보세요. 상무님께 전달, 하사님과 공사님, 도사님, 정비사님, 지사장님, 손님님.', // 직함+님 (Q-2)
  '김치찌개와 이번주 전화 주세요. 장소 변경 안내.',
  '버전 7.0.166, 2026-11-10 기준, 시각 12:30',
];

// 이름 탐지 표(Q-6). 이름이 빠지면 모델로 그대로 나가므로(유출) 양성 표를 넉넉히 둔다.
// "흔한 낱말로 시작하는 이름"(박사+랑, 이상+인, 이미+자)이 호칭·문맥이 있는데도 빠지던 회귀를 막는다.
const NAME_POSITIVES: Array<[text: string, names: string[]]> = [
  // QA 2회차 재현 문장(전부 [] 였다)
  ['고객 박사랑님 문의', ['박사랑']],
  ['하사랑님 안녕하세요', ['하사랑']],
  ['지사랑님', ['지사랑']],
  ['성명: 박사랑', ['박사랑']],
  ['고객 정비원님', ['정비원']],
  ['고객 이상인님 문의', ['이상인']],
  ['이미자님 문의', ['이미자']],
  ['정도원님 문의', ['정도원']],
  ['공지원님 문의', ['공지원']],
  ['예금주 이상인', ['이상인']],
  // 비슷한 변형: 붙인 호칭(님·씨) 뒤에는 조사가 올 수 없으니 '박사+랑' 으로 읽히지 않는다
  ['박사랑씨가 오셨습니다', ['박사랑']],
  ['정도원님과 통화했습니다', ['정도원']],
  ['고객 공지원님께 안내', ['공지원']],
  ['담당자 지사랑님 확인', ['지사랑']],
  ['이상국님 문의', ['이상국']],
  ['남궁지원님 접수', ['남궁지원']],
  // 콜론 붙은 표제 뒤 값은 이름이다(조사로 읽지 않는다)
  ['성명：하사랑', ['하사랑']],
  ['이름: 지사랑', ['지사랑']],
  ['예금주: 박사랑', ['박사랑']],
  ['받는분: 정도원', ['정도원']],
  ['성함: 정비원', ['정비원']],
  // 문맥 낱말 + 이름 + 조사: '랑' 뒤에 '이' 는 올 수 없으니 조사 읽기가 안 된다
  ['고객 박사랑이 문의했습니다', ['박사랑']],
  ['신청인 이미자가 접수', ['이미자']],
  ['신고인 이미자, 연락 바람', ['이미자']],
  // 띄어 쓴 직함
  ['이미자 과장에게 연결', ['이미자']],
  ['고객 이상인 님 안내', ['이상인']],
  // 두 글자 이름 + 님: 값에 '님' 이 섞이지 않는다
  [`고객 ${NAMES.twoChar}님 안녕하세요`, [NAMES.twoChar]],
];

// 직함·호칭 단독, 흔한 낱말 + 조사는 이름이 아니다(Q-2 음성 + 변형)
const NAME_NEGATIVES: string[] = [
  '박사님께 여쭤보세요',
  '상무님께 전달',
  '하사님과 공사님',
  '도사님',
  '정비사님께 문의',
  '정비원님께 문의',
  '지사장님 보고',
  '손님님',
  '이모님',
  '선배님',
  '신부님',
  '사모님',
  '진행자님께 전달',
  '이용자님 안내',
  '지원자님께 연락',
  '신청인님 확인',
  '상담원님 연결',
  '은행원님',
  '배우자님 동의',
  '이사장님 보고',
  '남편분께 전달',
  '고객님 안녕하세요',
  '고객 정보를 변경했습니다',
  '고객 문의가 접수되었습니다',
  '예금주 정보를 확인',
  '고객 정보만을 저장',
  '이상은 고객님께 안내드린 내용입니다',
  '이름 변경을 원합니다',
  '고객 지원팀 안내',
  '고객들 문의',
  '고객분들께 안내',
  '이미 처리되었습니다',
  '정도는 괜찮습니다',
  '공지를 확인하세요',
  '예금주 고객님께 안내', // 문맥 낱말 자체(예금주)는 이름이 아니다
  '고객 안내장 발송',
  '고객사 담당자님께 전달',
];

describe('AC-1 이름 탐지 표(유출 회귀 방지)', () => {
  it.each(NAME_POSITIVES)('양성: %s', (text, names) => {
    const found = detect(text, { detectors: ['name'] });
    expect(found.map((d) => d.value)).toEqual(names);
    for (const d of found) expect(text.slice(d.start, d.end)).toBe(d.value);
  });

  it.each(NAME_NEGATIVES)('음성: %s', (text) => {
    expect(detect(text, { detectors: ['name'] })).toEqual([]);
  });

  it('양성 이름은 pseudonymize 뒤 모델에 보낼 글에 남지 않는다', () => {
    for (const [text, names] of NAME_POSITIVES) {
      const out = pseudonymize(text, createVault());
      for (const n of names) expect(out).not.toContain(n);
    }
  });
});

describe('AC-1 한국형 식별번호 탐지', () => {
  it.each(POSITIVES.map((p) => [p.kind, p.text, p] as const))('양성 %s: %s', (_k, text, p) => {
    const found = detect(text);
    expect(found).toHaveLength(1);
    const d = found[0];
    expect(d).toMatchObject({ kind: p.kind, value: p.value, confidence: p.confidence });
    expect(text.slice(d?.start, d?.end)).toBe(p.value);
  });

  it.each(NEGATIVES)('음성: %s', (text) => {
    expect(detect(text)).toEqual([]);
  });

  it('양성 세트는 kind 8종을 모두 덮는다', () => {
    expect(new Set(POSITIVES.map((p) => p.kind))).toEqual(new Set(Object.keys(detectors)));
  });

  it('한 글에 여러 종류가 섞여도 위치 순으로 모두 찾는다', () => {
    const text = `고객 ${NAMES.lee}님(${SYN.phone1234}, 주민 ${SYN.rrnChecksumMale})이 신한은행 ${SYN.account}로 환불 요청. 사업자 ${SYN.brn}.`;
    expect(detect(text).map((d) => d.kind)).toEqual(['name', 'phone', 'rrn', 'account', 'brn']);
  });

  it('사용자 사전 이름은 문맥 없이도 찾는다', () => {
    const found = detect(`오늘 ${NAMES.park}이 다녀감`, { names: [NAMES.park] });
    expect(found).toMatchObject([{ kind: 'name', value: NAMES.park, confidence: 'context' }]);
    // 사전 없이는 문맥이 없어 찾지 않는다(보수적 기본값)
    expect(detect(`오늘 ${NAMES.park}이 다녀감`)).toEqual([]);
  });

  it('탐지기를 골라 켜고, 사용자 정의 탐지기를 더할 수 있다', () => {
    const text = `${NAMES.lee}님 ${SYN.phone1234} 사번 EMP-0042`;
    expect(detect(text, { detectors: ['phone'] }).map((d) => d.kind)).toEqual(['phone']);
    const employee: Detector = {
      kind: 'employee',
      label: '사번',
      find: (t) => [...t.matchAll(/EMP-\d{4}/g)].map((m) => ({ kind: 'employee', value: m[0], start: m.index, end: m.index + m[0].length, confidence: 'format' as const })),
    };
    expect(detect(text, { detectors: ['name', employee] }).map((d) => d.kind)).toEqual(['name', 'employee']);
  });

  it('모르는 탐지기 이름은 UnknownDetectorError', () => {
    expect(() => detect('x', { detectors: ['passport' as never] })).toThrow(UnknownDetectorError);
    expect(() => detect('x', { detectors: ['passport' as never] })).toThrow(KoPiiError);
  });
});
