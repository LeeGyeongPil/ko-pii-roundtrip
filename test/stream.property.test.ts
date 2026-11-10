// AC-4: 청크 분할 무관 결과 동일성.
// "어떤 위치에서 몇 번을 쪼개 흘려도(빈 조각·1글자·이모지 반쪽 포함) 스트리밍 복원 결과 = restore(전체)"
// 를 fast-check 속성 테스트로 확인한다. 시드를 고정해 매번 같은 1000가지 경우를 돈다.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  createJsonStringRestorer,
  createStreamRestorer,
  createVault,
  restore,
  restoreJsonText,
  type StreamRestorer,
  type Vault,
} from '../src/index';
import { scan } from '../src/restore';
import { NAMES, SYN } from './fixtures/synthetic';

const SEED = 20261110;
const NUM_RUNS = 1000;

function makeVault(): Vault {
  const vault = createVault();
  // [이름_1]~[이름_11]: '[이름_1' 이 [이름_1]·[이름_10]·[이름_11] 모두의 앞부분이 되도록 11개
  const names = [NAMES.lee, NAMES.kim, NAMES.park, NAMES.choi, '서울', '최미르', NAMES.twoChar, NAMES.compound, '김"가명\\', '이😀예시', '박샘플A'];
  for (const n of names) vault.tokenFor('name', n);
  vault.tokenFor('phone', SYN.phone5678);
  vault.tokenFor('phone', SYN.phone1234);
  vault.tokenFor('rrn', SYN.rrnChecksumMale);
  vault.tokenFor('email', SYN.email);
  return vault;
}

const vault = makeVault();
const TOKENS = vault.tokens();

// 글 조각 재료: 가명, 조사 후보, 조사처럼 시작하는 낱말, 가명 흉내(앞부분·깨진 꼴), 이모지, 아무 글자
const fragment = fc.oneof(
  { weight: 5, arbitrary: fc.constantFrom(...TOKENS) },
  { weight: 4, arbitrary: fc.constantFrom('은', '는', '이', '가', '을', '를', '과', '와', '으로', '로', '이랑', '랑', '으', '이라') },
  { weight: 3, arbitrary: fc.constantFrom('행', '은행', '의', '도', '만', '요', '서', '다', '에게', ' ', '.', ',', '\n', '"', '\\') },
  { weight: 2, arbitrary: fc.constantFrom('[', ']', '_', '[이름', '[이름_', '[이름_1', '[전화_', '[이름_99]', '[[이름_1]]', '[이름 1]') },
  { weight: 1, arbitrary: fc.constantFrom('😀', '👍🏽', '가😀', 'A') },
  { weight: 1, arbitrary: fc.string({ maxLength: 4 }) },
);
const textArb = fc.array(fragment, { maxLength: 30 }).map((parts) => parts.join(''));

/** 텍스트와 자를 위치들(중복 허용 → 빈 조각, 0·끝 포함, UTF-16 단위라 서로게이트 쌍 가운데도 자른다) */
const splitCase = textArb.chain((text) =>
  fc.tuple(fc.constant(text), fc.array(fc.integer({ min: 0, max: text.length }), { maxLength: 40 })),
);

function cut(text: string, positions: number[]): string[] {
  const cuts = [...positions].sort((a, b) => a - b);
  const pieces: string[] = [];
  let prev = 0;
  for (const c of cuts) {
    pieces.push(text.slice(prev, c));
    prev = c;
  }
  pieces.push(text.slice(prev));
  return pieces;
}

function runStream(restorer: StreamRestorer, pieces: string[]): { joined: string; emitted: string[] } {
  const emitted = pieces.map((p) => restorer.push(p));
  emitted.push(restorer.flush());
  return { joined: emitted.join(''), emitted };
}

function isHigh(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

describe('AC-4 청크 분할 무관 결과 동일성', () => {
  it(`스트리밍 복원 = restore(전체) — fast-check seed ${SEED}, ${NUM_RUNS}회`, () => {
    const details = fc.check(
      fc.property(splitCase, ([text, positions]) => {
        const pieces = cut(text, positions);
        const { joined, emitted } = runStream(createStreamRestorer(vault), pieces);
        expect(joined).toBe(restore(text, vault));
        // 내보낸 조각이 이모지 앞 절반(high surrogate)으로 끝나지 않는다(마지막 flush 제외)
        for (const e of emitted.slice(0, -1)) {
          if (e.length > 0) expect(isHigh(e.charCodeAt(e.length - 1))).toBe(false);
        }
      }),
      { seed: SEED, numRuns: NUM_RUNS },
    );
    // 반례 0개를 출력으로도 남긴다(README 장면용)
    console.log(`PROPERTY stream runs=${details.numRuns} failed=${details.failed ? 1 : 0} seed=${SEED}`);
    expect(details.failed, String(details.counterexample)).toBe(false);
    expect(details.numRuns).toBe(NUM_RUNS);
  });

  it(`josa:false 도 같은 성질 — ${NUM_RUNS}회`, () => {
    fc.assert(
      fc.property(splitCase, ([text, positions]) => {
        const { joined } = runStream(createStreamRestorer(vault, { josa: false }), cut(text, positions));
        expect(joined).toBe(restore(text, vault, { josa: false }));
      }),
      { seed: SEED + 1, numRuns: NUM_RUNS },
    );
  });

  it(`JSON 문자열 복원기도 같은 성질 — ${NUM_RUNS}회`, () => {
    fc.assert(
      fc.property(splitCase, ([text, positions]) => {
        const { joined } = runStream(createJsonStringRestorer(vault), cut(text, positions));
        expect(joined).toBe(restoreJsonText(text, vault));
      }),
      { seed: SEED + 2, numRuns: NUM_RUNS },
    );
  });

  it('JSON 복원기는 따옴표·역슬래시가 든 값을 이스케이프해 JSON 을 지킨다(임의 분할)', () => {
    const quoted = vault.tokens().find((t) => vault.original(t) === '김"가명\\') as string;
    const json = JSON.stringify({ name: quoted, memo: `${quoted}은 ${TOKENS.find((t) => t.startsWith('[전화'))}으로 연락` });
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: json.length }), { maxLength: 20 }), (positions) => {
        const { joined } = runStream(createJsonStringRestorer(vault), cut(json, positions));
        const parsed = JSON.parse(joined) as { name: string; memo: string };
        expect(parsed.name).toBe('김"가명\\');
        expect(parsed.memo.startsWith('김"가명\\')).toBe(true);
      }),
      { seed: SEED + 3, numRuns: 300 },
    );
  });

  it('끝 표시 없이 끝난 스트림도 flush() 로 꼬리를 잃지 않는다', () => {
    const lee = vault.tokens().find((t) => vault.original(t) === NAMES.lee) as string;
    const r = createStreamRestorer(vault);
    // 가명으로 끝나는 글: 조사 판정을 위해 마지막 가명을 붙잡고 있다
    const pushed = r.push(`안녕하세요 ${lee}`);
    expect(pushed).toBe('안녕하세요 ');
    expect(r.flush()).toBe(NAMES.lee); // flush 가 없으면 이 꼬리를 잃는다
    expect(r.flush()).toBe(''); // 두 번 불러도 안전
  });

  it('보류하는 꼬리는 가장 긴 가명 + 조사 두 글자 + 경계 한 글자를 넘지 않는다', () => {
    // 버퍼 상한이 있어야 스트림이 길어져도 메모리가 늘지 않고, 화면 지연도 몇 글자로 묶인다
    const bound = Math.max(...TOKENS.map((t) => t.length)) + 3;
    fc.assert(
      fc.property(textArb, (text) => {
        for (let k = 0; k <= text.length; k++) {
          const r = scan(text.slice(0, k), TOKENS, vault, false, { josa: true, encode: (v) => v });
          expect(k - r.consumed).toBeLessThanOrEqual(bound);
        }
      }),
      { seed: SEED + 4, numRuns: 300 },
    );
  });
});
