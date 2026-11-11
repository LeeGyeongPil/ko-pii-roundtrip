// 이름: 성씨 사전 + 문맥(호칭·직함·앞 문맥 낱말) + 사용자 사전.
//
// 한국어 이름은 일반 낱말과 모양이 같아서(정상·한국·이번…) 성씨만 보고 찾으면 오탐이 많다.
// 그래서 아래 셋 중 하나가 있을 때만 이름으로 본다(보수적 기본값).
//   A. 바로 뒤에 붙은 호칭·직함: 이예시님, 김가명고객님, 박샘플 과장(띄어 쓴 경우는 세 글자만)
//   B. 바로 앞 문맥 낱말: 고객 이예시가, 성명: 김가명
//   C. 사용자 사전(names 옵션): 문맥 없이도 찾는다
// 놓친 이름은 names 로 보충하는 것을 전제로 한다.
//
// 증거가 있어도 후보가 "흔한 낱말"로 읽히면 버린다. 다만 증거의 세기에 따라 버리는 범위가 다르다:
//   - 두 글자 낱말·직함 단독(박사님·상무님·정보): 늘 버린다.
//   - '박사+랑'·'이상+은' 처럼 "낱말 + 조사"로 읽힐 때: 뒤에 님·씨가 붙었거나(조사 뒤에는 님이 올 수 없다)
//     '성명:' 처럼 콜론 붙은 표제 뒤면 이름으로 본다.
//   - 세 글자 직함 낱말(정비원·진행자): '고객 ○○○님', '성명: ○○○' 같은 강한 문맥이면 이름으로 본다.
// 이름이 빠지면 모델로 그대로 나가므로(유출), 애매하면 이름 쪽(과잉 치환)을 택한다.

import type { Detection, Detector } from '../types';
import {
  COMPOUND_SURNAMES,
  CONTEXT_WORDS,
  GROUP_SUFFIX_LAST,
  JOSA_LIKE_LAST,
  JOSA_STACK,
  NAME_JOSA,
  NOT_NAMES,
  SURNAMES,
  TITLES_ATTACHED,
  TITLES_SPACED,
} from './surnames';

const HANGUL_WORD = /[가-힣]+/g;
const CONTEXT_BEFORE = /([가-힣]+)([ \t]*[:：]?[ \t]*)$/;

function isHangul(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '가' && ch <= '힣';
}

/** 후보를 이름으로 볼 근거들 */
interface Evidence {
  /** 바로 뒤에 붙은 호칭·직함(님·씨·고객님·과장…) */
  titleAttached: boolean;
  /** 앞 문맥 낱말(고객·성명·예금주…). 없으면 null */
  context: { colon: boolean } | null;
}

/** 후보 바로 앞의 문맥 낱말을 찾는다. '성명: ' 처럼 콜론이 있었는지도 알려 준다 */
function contextBefore(text: string, at: number): Evidence['context'] {
  const m = CONTEXT_BEFORE.exec(text.slice(Math.max(0, at - 16), at));
  const sep = m?.[2] ?? '';
  if (m === null || sep === '') return null; // 구분자(공백·콜론) 없이 붙어 있으면 아님
  const word = (m[1] as string).replace(/님$/, '');
  const colon = /[:：]/.test(sep);
  if (CONTEXT_WORDS.has(word)) return { colon };
  // '고객명:'·'환자명:' 꼴: 콜론이 있고 '명'을 뗀 앞부분이 문맥 낱말이면 표제로 본다(콜론 없는 '고객명 홍길동'은 오탐 위험 때문에 제외)
  if (colon && word.length > 1 && word.endsWith('명') && CONTEXT_WORDS.has(word.slice(0, -1))) return { colon };
  return null;
}

/** 후보(cand) 뒤에 suffix 가 붙은 꼴이 "흔한 낱말"로 읽혀서 이름이 아니라고 볼지 */
function readsAsCommonWord(cand: string, suffix: string, ev: Evidence): boolean {
  // 강한 문맥: 문맥 낱말 + (붙인 호칭 또는 콜론). '고객 ○○○님', '성명: ○○○'
  const strong = ev.context !== null && (ev.titleAttached || ev.context.colon);

  // 1. 후보 자체가 문맥 낱말(예금주·신고인)이거나 흔한 낱말·직함
  if (CONTEXT_WORDS.has(cand)) return true;
  if (NOT_NAMES.has(cand)) return cand.length <= 2 || !strong; // 두 글자(직함 단독)는 늘, 세 글자는 강한 문맥이 아닐 때만
  if (cand.length < 3) return false;

  const last = cand[cand.length - 1] as string;
  const head = cand.slice(0, -1);
  if (last === '님') return true; // '조연님' 의 '님' 은 이름에 들어가지 않는다
  if (!NOT_NAMES.has(head)) return false;

  // 2. "흔한 낱말 + 조사"(정보를·이상은·박사랑): 그 뒤가 비었거나 겹칠 수 있는 조사일 때만 그렇게 읽힌다
  if (JOSA_LIKE_LAST.has(last)) {
    const josaReading = suffix === '' || (JOSA_STACK[last] ?? []).includes(suffix);
    // 님·씨가 붙었으면 suffix 가 조사가 아니라 josaReading 이 거짓이 된다. 콜론 표제 뒤 값도 조사로 읽지 않는다
    return josaReading && ev.context?.colon !== true;
  }
  // 3. "흔한 낱말 + 무리·장소 접미사"(고객들·지원팀·고객분)
  if (GROUP_SUFFIX_LAST.has(last)) return !strong;
  return false;
}

/** 한글 낱말 하나(word, text 안 위치 at)에서 이름 부분의 길이를 찾는다. 없으면 0 */
function nameLengthIn(word: string, text: string, at: number): number {
  const surnames: string[] = [];
  for (const c of COMPOUND_SURNAMES) if (word.startsWith(c) && word.length >= 3) surnames.push(c);
  if (SURNAMES.has(word[0] as string)) surnames.push(word[0] as string);

  for (const surname of surnames) {
    for (const given of [2, 1]) {
      const len = surname.length + given;
      if (len > word.length) continue;
      const cand = word.slice(0, len);
      const suffix = word.slice(len);
      // '변심으' + '로' 처럼 후보 끝 글자와 뒤가 합쳐 조사가 되면, 더 짧은 후보가 맞다
      if ((cand.endsWith('으') && suffix.startsWith('로')) || (cand.endsWith('이') && suffix.startsWith('랑'))) continue;

      // 근거 모으기
      const ev: Evidence = {
        titleAttached: suffix.length > 0 && TITLES_ATTACHED.some((t) => suffix.startsWith(t)), // A. 이예시님
        context: contextBefore(text, at), // B. 고객 이예시가, 성명: 김가명
      };
      let titleSpaced = false; // A'. 띄어 쓴 호칭·직함(세 글자 이상만): 박샘플 과장
      if (suffix === '' && cand.length >= 3) {
        const after = text.slice(at + word.length);
        titleSpaced = /^ [가-힣]/.test(after) && TITLES_SPACED.some((t) => after.startsWith(' ' + t));
      }
      const contextOk = ev.context !== null && NAME_JOSA.includes(suffix); // 문맥 낱말 뒤 + 이름 뒤는 조사거나 끝
      if (!ev.titleAttached && !titleSpaced && !contextOk) continue; // 이름이라는 근거가 없다

      if (readsAsCommonWord(cand, suffix, ev)) continue;
      return len;
    }
  }
  return 0;
}

function findDictionaryNames(text: string, names: readonly string[]): Detection[] {
  const found: Detection[] = [];
  const sorted = [...new Set(names)].filter((n) => n.length > 0).sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(name, from);
      if (at === -1) break;
      from = at + 1;
      if (isHangul(text[at - 1])) continue; // '정이예시' 처럼 다른 낱말 안이면 건너뛴다
      found.push({ kind: 'name', value: name, start: at, end: at + name.length, confidence: 'context' });
    }
  }
  return found;
}

/** 사용자 사전을 더한 이름 탐지기를 만든다 */
export function createNameDetector(names: readonly string[] = []): Detector {
  return {
    kind: 'name',
    label: '이름',
    find(text: string): Detection[] {
      const found = findDictionaryNames(text, names);
      for (const m of text.matchAll(HANGUL_WORD)) {
        const len = nameLengthIn(m[0], text, m.index);
        if (len === 0) continue;
        found.push({ kind: 'name', value: m[0].slice(0, len), start: m.index, end: m.index + len, confidence: 'context' });
      }
      return found;
    },
  };
}

export const nameDetector: Detector = createNameDetector();
