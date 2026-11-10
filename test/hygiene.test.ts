// AC-10: 시간·로캘·경로 무의존과 합성 픽스처.
// - src 는 시계·로캘·환경 변수·절대 경로를 쓰지 않는다(어디서 돌려도 같은 결과).
// - 레포에 나오는 번호 모양 문자열은 모두 test/fixtures/synthetic.ts 생성기가 만든 합성 값이어야 한다.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createVault, detect, pseudonymize, restore } from '../src/index';
import { isSyntheticNumber, NAMES, SYN } from './fixtures/synthetic';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const SRC = walk(join(repo, 'src'));
const SCANNED = [
  ...SRC,
  ...walk(join(repo, 'test')),
  ...walk(join(repo, 'examples')),
  ...['README.md', 'CHANGELOG.md'].map((f) => join(repo, f)).filter((p) => existsSync(p)),
];

/** 번호 모양: 숫자 묶음(2자리 이상)을 '-'·' ' 로 이은 것 또는 붙여 쓴 10자리 이상. 숫자가 합쳐 10자리 이상인 것만 */
const NUMBER_LIKE = /(?<![\w.])\d{2,}(?:[- ]\d{2,})+(?![\w.])|(?<![\w.])\d{10,}(?![\w.])/g;

function numberLike(text: string): string[] {
  return [...text.matchAll(NUMBER_LIKE)].map((m) => m[0]).filter((s) => s.replace(/\D/g, '').length >= 10);
}

describe('AC-10 시간·로캘·경로 무의존', () => {
  it('src 에 Date.now·new Date(·toLocale·Intl.·process.env·절대 경로가 없다', () => {
    const banned = [/Date\.now/, /new Date\(/, /toLocale/, /\bIntl\./, /process\.env/, /['"`](\/(Users|home|Volumes|private|tmp|var)\/|[A-Za-z]:\\)/];
    const hits: string[] = [];
    for (const file of SRC) {
      const text = readFileSync(file, 'utf8');
      for (const re of banned) if (re.test(text)) hits.push(`${relative(repo, file)}: ${re}`);
    }
    expect(hits).toEqual([]);
  });

  it('지금 시간대·로캘과 상관없이 결과가 같다(기록용 출력)', () => {
    // npm test 를 TZ=Pacific/Kiritimati LANG=tr_TR.UTF-8 로 돌려도 이 결과는 바뀌지 않아야 한다
    console.log(`ENV TZ=${Intl.DateTimeFormat().resolvedOptions().timeZone} locale=${Intl.DateTimeFormat().resolvedOptions().locale}`);
    const vault = createVault();
    const text = `고객 ${NAMES.lee}님 ${SYN.phone1234} 메일 ${SYN.email.toUpperCase()}`;
    const sent = pseudonymize(text, vault);
    expect(sent).toBe('고객 [이름_1]님 [전화_1] 메일 [이메일_1]');
    expect(restore('[이메일_1]은 확인', vault)).toBe(`${SYN.email.toUpperCase()}은 확인`); // M(엠) 받침 — 대문자 I 를 쓰는 터키어 로캘에서도 같다
    expect(detect(SYN.rrnChecksumMale)[0]?.confidence).toBe('checksum');
  });
});

describe('AC-10 합성 픽스처', () => {
  it('검사 대상 파일이 비어 있지 않다', () => {
    expect(SRC.length).toBeGreaterThan(5);
    expect(SCANNED.some((f) => f.endsWith('demo.mjs'))).toBe(true);
  });

  it('src·test·examples·README·CHANGELOG 의 번호 모양 문자열은 모두 합성 생성기 집합에 속한다', () => {
    const foreign: string[] = [];
    let seen = 0;
    for (const file of SCANNED) {
      for (const s of numberLike(readFileSync(file, 'utf8'))) {
        seen += 1;
        if (!isSyntheticNumber(s)) foreign.push(`${relative(repo, file)}: ${s}`);
      }
    }
    expect(foreign).toEqual([]);
    expect(seen).toBeGreaterThan(0);
  });

  it('검사기가 실제로 걸러 낸다(자체 점검)', () => {
    // 합성 집합 밖의 모양(다른 국번 전화, 실제 세무서 코드꼴 사업자번호)은 통과하지 못해야 한다.
    // 이 파일도 검사 대상이라 그런 모양을 글자 그대로 적지 않고 조립한다.
    const otherPhone = ['010', '1234', '0000'].join('-');
    const otherBrn = ['123', '45', '67890'].join('-');
    expect(numberLike(`전화 ${otherPhone}, 사업자 ${otherBrn}`)).toHaveLength(2);
    expect(isSyntheticNumber(otherPhone)).toBe(false);
    expect(isSyntheticNumber(otherBrn)).toBe(false);
    expect(isSyntheticNumber(SYN.phone5678)).toBe(true);
    expect(isSyntheticNumber(SYN.rrnChecksumMale.replace('-', ''))).toBe(true);
    expect(numberLike('버전 7.0.166, 날짜 2026-11-10, 시드 20261110')).toEqual([]);
  });
});
