// AC-3: 조사 교정 — 받침 판정(한글·숫자 읽는 소리·영문 글자 이름), ㄹ 받침 으로→로,
// 긴 조사 우선, 경계 규칙, josa:false. 한글로 끝나는 값은 es-hangul josa() 와 교차 검증한다.

import { josa as esJosa } from 'es-hangul';
import { describe, expect, it } from 'vitest';
import { attachJosa, createVault, hasBatchim, restore, type JosaPair } from '../src/index';
import { NAMES, SYN } from './fixtures/synthetic';

const PAIRS: JosaPair[] = ['은/는', '이/가', '을/를', '과/와', '으로/로', '이랑/랑'];
// es-hangul 은 과/와 를 '와/과' 순서로 받는다
const ES_OPTION = {
  '은/는': '은/는',
  '이/가': '이/가',
  '을/를': '을/를',
  '과/와': '와/과',
  '으로/로': '으로/로',
  '이랑/랑': '이랑/랑',
} as const;

// 한글로 끝나는 값: 받침 없음(이예시), 받침 있음(김가명·박샘플), ㄹ 받침(서울·최미르), 두 글자(조연)
const HANGUL_WORDS = [NAMES.lee, NAMES.kim, NAMES.park, '서울', '최미르', NAMES.twoChar, '남궁가상'];

describe('AC-3 조사 교정', () => {
  describe('한글 끝 값은 es-hangul josa() 와 같다', () => {
    const cases = HANGUL_WORDS.flatMap((w) => PAIRS.map((p) => [w, p] as const));
    it.each(cases)('%s + %s', (word, pair) => {
      expect(attachJosa(word, pair)).toBe(esJosa(word, ES_OPTION[pair]));
    });
    it('사례 수는 40개 이상', () => {
      expect(cases.length).toBeGreaterThanOrEqual(40);
    });
  });

  describe('숫자·영문 끝은 읽는 소리 기준', () => {
    it.each([
      // 숫자 마지막 자리: 0 영, 1 일, 2 이, 3 삼, 4 사, 5 오, 6 육, 7 칠, 8 팔, 9 구
      [SYN.phone5678, '으로/로', `${SYN.phone5678}로`], // 팔: ㄹ 받침 → 로
      [SYN.phone1234, '과/와', `${SYN.phone1234}와`], // 사: 받침 없음
      [SYN.phone1234, '을/를', `${SYN.phone1234}를`],
      [SYN.phone0000, '은/는', `${SYN.phone0000}은`], // 영: ㅇ 받침
      [SYN.phone0000, '으로/로', `${SYN.phone0000}으로`],
      [SYN.account, '이/가', `${SYN.account}가`], // 4
      [SYN.brn, '을/를', `${SYN.brn}를`], // 5 오
      [SYN.card, '으로/로', `${SYN.card}로`], // 8 팔
      [SYN.account2, '이/가', `${SYN.account2}이`], // 0 영
      ['A-301', '은/는', 'A-301은'], // 1 일
      ['3', '이랑/랑', '3이랑'], // 삼
      ['6', '으로/로', '6으로'], // 육: ㄱ 받침
      ['7', '으로/로', '7로'], // 칠: ㄹ 받침
      ['9', '이/가', '9가'], // 구
      // 영문 마지막 글자 이름: L 엘, M 엠, N 엔, R 알 만 받침
      [SYN.email, '으로/로', `${SYN.email}으로`], // m 엠
      [SYN.email2, '은/는', `${SYN.email2}는`], // g 지
      ['Kim', '이/가', 'Kim이'], // m
      ['Paul', '으로/로', 'Paul로'], // l 엘: ㄹ
      ['Lee', '을/를', 'Lee를'], // e 이
      ['Taylor', '과/와', 'Taylor과'], // r 알
      ['Ann', '이랑/랑', 'Ann이랑'], // n 엔
    ] as const)('%s + %s → %s', (word, pair, expected) => {
      expect(attachJosa(word, pair)).toBe(expected);
    });

    it('판정할 수 없는 끝(기호)은 null, attachJosa 는 둘 다 적는다', () => {
      expect(hasBatchim('가명!')).toBeNull();
      expect(hasBatchim('')).toBeNull();
      expect(attachJosa('(주)', '은/는')).toBe('(주)은(는)');
      expect(hasBatchim('김가명')).toBe(true);
      expect(hasBatchim('이예시')).toBe(false);
    });
  });

  describe('restore 가 가명 뒤 조사를 고친다', () => {
    const vault = createVault();
    const lee = vault.tokenFor('name', NAMES.lee); // [이름_1] 이예시(받침 없음)
    const kim = vault.tokenFor('name', NAMES.kim); // [이름_2] 김가명(받침 ㅇ)
    const phone = vault.tokenFor('phone', SYN.phone5678); // [전화_1] …8(팔, ㄹ)
    const seoul = vault.tokenFor('name', '서울'); // [이름_3] ㄹ 받침

    it.each([
      [`${lee}은 왔다`, `${NAMES.lee}는 왔다`],
      [`${lee}이 왔다`, `${NAMES.lee}가 왔다`],
      [`${lee}을 불러`, `${NAMES.lee}를 불러`],
      [`${lee}과 함께`, `${NAMES.lee}와 함께`],
      [`${lee}이랑 같이`, `${NAMES.lee}랑 같이`], // 긴 조사 '이랑'을 '이'로 읽지 않는다
      [`${kim}는 왔다`, `${NAMES.kim}은 왔다`],
      [`${kim}랑 같이`, `${NAMES.kim}이랑 같이`],
      [`${kim}로 보냄`, `${NAMES.kim}으로 보냄`],
      [`${phone}으로 연락`, `${SYN.phone5678}로 연락`], // ㄹ 받침 예외
      [`${seoul}으로 이동`, '서울로 이동'],
      [`${lee}과의 통화`, `${NAMES.lee}와의 통화`], // 허용 후속 글자 '의'
      [`${kim}로도 가능`, `${NAMES.kim}으로도 가능`], // '도'
      [`${lee}은.`, `${NAMES.lee}는.`], // 문장부호 경계
      [`${lee}은`, `${NAMES.lee}는`], // 글 끝
      // 경계 규칙: 조사 뒤에 다른 한글이 붙으면 낱말의 일부로 보고 건드리지 않는다
      [`${lee}은행 계좌`, `${NAMES.lee}은행 계좌`],
      [`${kim}가방`, `${NAMES.kim}가방`],
      [`${lee}이다`, `${NAMES.lee}이다`], // 서술격 '이다'는 조사 쌍이 아님
      [`${lee}에게`, `${NAMES.lee}에게`], // 다루지 않는 조사는 그대로
    ])('%s → %s', (input, expected) => {
      expect(restore(input, vault)).toBe(expected);
    });

    it('josa:false 면 조사를 고치지 않는다', () => {
      expect(restore(`${lee}은 ${phone}으로`, vault, { josa: false })).toBe(`${NAMES.lee}은 ${SYN.phone5678}으로`);
    });
  });
});
