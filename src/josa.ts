// 받침 판정과 조사 고르기.
// 가명([이름_1]) 뒤에 모델이 붙인 조사는 "일"(1) 소리에 맞춘 것이라, 원래 값으로 되돌린 뒤
// 원래 값의 마지막 소리에 맞게 다시 골라야 한다. 예: [이름_1]은 → 이예시는

import type { JosaPair } from './types';

const HANGUL_FIRST = 0xac00; // '가'
const HANGUL_LAST = 0xd7a3; // '힣'
const JONG_COUNT = 28; // 종성(받침) 경우의 수(받침 없음 포함)
const JONG_RIEUL = 8; // 종성 표에서 ㄹ 의 순번

/** 받침 정보: 없음 / 있음(ㄹ) / 있음(ㄹ 아님) */
type Final = 'none' | 'rieul' | 'other';

// 숫자는 한 자리씩 읽는 소리 기준(전화·계좌 번호를 읽는 방식):
// 0 영, 1 일, 2 이, 3 삼, 4 사, 5 오, 6 육, 7 칠, 8 팔, 9 구
const DIGIT_FINAL: Record<string, Final> = {
  '0': 'other',
  '1': 'rieul',
  '2': 'none',
  '3': 'other',
  '4': 'none',
  '5': 'none',
  '6': 'other',
  '7': 'rieul',
  '8': 'rieul',
  '9': 'none',
};

// 영문은 글자 이름 소리 기준: L 엘, M 엠, N 엔, R 알 만 받침이 있다
// (A 에이, B 비, C 씨 … Z 지/제트 는 모두 받침 없음)
const LETTER_FINAL: Record<string, Final> = { l: 'rieul', m: 'other', n: 'other', r: 'rieul' };

function finalOf(word: string): Final | null {
  if (word.length === 0) return null;
  const last = word[word.length - 1] as string;
  const code = last.charCodeAt(0);
  if (code >= HANGUL_FIRST && code <= HANGUL_LAST) {
    const jong = (code - HANGUL_FIRST) % JONG_COUNT;
    if (jong === 0) return 'none';
    return jong === JONG_RIEUL ? 'rieul' : 'other';
  }
  const digit = DIGIT_FINAL[last];
  if (digit !== undefined) return digit;
  if (/^[A-Za-z]$/.test(last)) return LETTER_FINAL[last.toLowerCase()] ?? 'none';
  return null; // 기호·한자·이모지 등은 판정하지 않는다
}

/**
 * 마지막 글자에 받침이 있는지. 한글 음절·숫자(읽는 소리)·영문(글자 이름)만 판정하고,
 * 그 밖의 글자로 끝나면 null.
 */
export function hasBatchim(word: string): boolean | null {
  const f = finalOf(word);
  return f === null ? null : f !== 'none';
}

const PAIRS: Record<JosaPair, readonly [string, string]> = {
  '은/는': ['은', '는'],
  '이/가': ['이', '가'],
  '을/를': ['을', '를'],
  '과/와': ['과', '와'],
  '으로/로': ['으로', '로'],
  '이랑/랑': ['이랑', '랑'],
};

/** 받침에 맞는 조사 하나를 고른다. 판정 불가면 null */
export function pickJosa(word: string, pair: JosaPair): string | null {
  const f = finalOf(word);
  if (f === null) return null;
  const [withFinal, withoutFinal] = PAIRS[pair];
  if (pair === '으로/로') {
    // ㄹ 받침은 받침이 없는 것처럼 '로': 서울로, 010-0000-5678로(팔)
    return f === 'other' ? withFinal : withoutFinal;
  }
  return f === 'none' ? withoutFinal : withFinal;
}

/** 단어 + 맞는 조사. 받침을 판정할 수 없으면 `은(는)` 처럼 둘 다 적는다 */
export function attachJosa(word: string, pair: JosaPair): string {
  const picked = pickJosa(word, pair);
  if (picked !== null) return word + picked;
  const [a, b] = PAIRS[pair];
  return `${word}${a}(${b})`;
}

// ---- 복원기용: 가명 바로 뒤에 붙은 조사 찾기 ----

/** 조사 후보와 그 쌍. 긴 것부터 본다('이랑'을 '이'로, '으로'를 '로'로 잘못 읽지 않도록) */
const CANDIDATES: ReadonlyArray<readonly [string, JosaPair]> = [
  ['이랑', '이랑/랑'],
  ['으로', '으로/로'],
  ['은', '은/는'],
  ['는', '은/는'],
  ['이', '이/가'],
  ['가', '이/가'],
  ['을', '을/를'],
  ['를', '을/를'],
  ['과', '과/와'],
  ['와', '과/와'],
  ['랑', '이랑/랑'],
  ['로', '으로/로'],
];

/**
 * 조사 뒤에 와도 되는 한글 글자. 이 밖의 한글이 바로 이어지면 조사가 아니라 낱말의 일부로 본다.
 * 예: '[이름_1]은행'의 '은'은 조사가 아니다. '[이름_1]과의', '[전화_1]로도', '[이름_1]으로서'는 조사.
 */
const ALLOWED_AFTER = new Set(['의', '도', '만', '요', '서', '써']);

function isHangulSyllable(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= HANGUL_FIRST && code <= HANGUL_LAST;
}

export type JosaMatch =
  | { type: 'match'; text: string; pair: JosaPair }
  | { type: 'none' }
  | { type: 'need-more' };

/**
 * s 의 at 위치에서 시작하는 조사를 찾는다.
 * final=false(스트림 중간)이면, 뒤 글자가 아직 안 와서 결정할 수 없을 때 need-more 를 돌려준다.
 * 이 규칙 덕분에 "어떻게 쪼개 넣어도 한 번에 넣은 것과 같은 결과"가 지켜진다.
 */
export function matchJosaAt(s: string, at: number, final: boolean): JosaMatch {
  const rest = s.length - at;
  for (const [cand, pair] of CANDIDATES) {
    if (rest < cand.length) {
      // 아직 덜 왔다: 지금 있는 꼬리가 후보의 앞부분이면 더 기다린다
      if (!final && cand.startsWith(s.slice(at))) return { type: 'need-more' };
      continue;
    }
    if (!s.startsWith(cand, at)) continue;
    const after = at + cand.length;
    if (after === s.length) {
      if (!final) return { type: 'need-more' }; // 조사 뒤 경계 글자를 아직 모른다
      return { type: 'match', text: cand, pair };
    }
    const next = s[after] as string;
    if (!isHangulSyllable(next) || ALLOWED_AFTER.has(next)) {
      return { type: 'match', text: cand, pair };
    }
    // 뒤에 다른 한글이 붙었다 → 이 후보는 조사가 아님. 더 짧은 후보를 계속 본다
  }
  return { type: 'none' };
}
