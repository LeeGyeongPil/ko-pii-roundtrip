// 한 번 훑기(single-pass) 복원.
// 앞에서부터 한 번만 읽으며 가명을 원래 값으로 바꾸고, 바꾼 결과는 다시 들여다보지 않는다.
// (가명을 하나씩 replace 하면, 원래 값이 다른 가명과 같을 때 두 번 바뀌는 사고가 난다.)
//
// 스트리밍 복원기(stream.ts)와 JSON 복원기(json-stream.ts)도 이 scan() 하나를 같이 쓴다.
// 그래서 "어떻게 쪼개 넣어도 결과가 restore(전체)와 같다"를 지키기 쉽다.

import { matchJosaAt, pickJosa } from './josa';
import { assertText, assertVault } from './validate';
import type { RestoreOptions, Vault } from './types';

export interface ScanOptions {
  josa: boolean;
  /** 원래 값을 출력에 넣기 전에 바꾸는 함수(JSON 문자열 안이면 이스케이프) */
  encode: (value: string) => string;
}

export interface ScanResult {
  /** 지금 확정해서 내보낼 수 있는 글 */
  out: string;
  /** s 에서 처리를 끝낸 위치. 나머지(s.slice(consumed))는 다음 조각과 이어 붙여 다시 본다 */
  consumed: number;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * s 를 앞에서부터 훑는다.
 * final=false 이면 "뒤에 글이 더 오면 판단이 바뀔 수 있는" 지점에서 멈추고 consumed 를 돌려준다.
 *  - 꼬리가 어떤 가명의 앞부분일 때(예: '[이름_')
 *  - 가명 바로 뒤 조사를 아직 판정할 수 없을 때(예: 가명 다음 글자가 아직 안 옴)
 *  - 꼬리가 서로게이트 쌍의 앞 절반일 때(이모지가 반으로 쪼개져 나가지 않도록)
 * final=true 이면 끝까지 처리한다.
 */
export function scan(s: string, tokens: readonly string[], vault: Vault, final: boolean, opts: ScanOptions): ScanResult {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s.charCodeAt(i);

    // 가명은 모두 '[' 로 시작한다. '[' 가 아니면 그냥 내보낸다.
    if (ch !== 0x5b /* [ */) {
      if (!final && i === s.length - 1 && isHighSurrogate(ch)) break; // 이모지 앞 절반은 보류
      out += s[i];
      i += 1;
      continue;
    }

    // 1) 여기서 시작하는 가명 찾기(긴 것부터)
    const rest = s.length - i;
    let token: string | undefined;
    let waitForMore = false;
    for (const t of tokens) {
      if (rest < t.length) {
        // 꼬리가 (더 긴) 가명의 앞부분이면 다음 조각을 기다린다
        if (!final && t.startsWith(s.slice(i))) waitForMore = true;
        continue;
      }
      if (s.startsWith(t, i)) {
        token = t;
        break;
      }
    }
    // 더 긴 가명이 될 가능성이 남아 있으면, 짧은 가명이 맞았더라도 기다린다(긴 것 우선 규칙 유지)
    if (waitForMore) break;
    if (token === undefined) {
      out += '[';
      i += 1;
      continue;
    }

    // 2) 원래 값 + (선택) 조사 교정
    const value = vault.original(token) as string;
    const afterToken = i + token.length;
    if (!opts.josa) {
      out += opts.encode(value);
      i = afterToken;
      continue;
    }
    const m = matchJosaAt(s, afterToken, final);
    if (m.type === 'need-more') break; // 가명째로 보류: 다음 조각과 함께 다시 본다
    out += opts.encode(value);
    i = afterToken;
    if (m.type === 'match') {
      // 받침을 판정할 수 없는 값(기호로 끝남 등)이면 모델이 쓴 조사를 그대로 둔다
      out += pickJosa(value, m.pair) ?? m.text;
      i += m.text.length;
    }
  }
  return { out, consumed: i };
}

const identity = (v: string): string => v;

/**
 * 글 전체를 한 번에 복원한다. 기본으로 조사도 고친다.
 * 예: '[이름_1]은 [전화_1]으로 연락' → '이예시는 010-0000-1234로 연락'
 */
export function restore(text: string, vault: Vault, opts: RestoreOptions = {}): string {
  assertText(text, 'restore(text, vault)');
  assertVault(vault, 'restore(text, vault)');
  const tokens = vault.tokens();
  if (tokens.length === 0) return text;
  return scan(text, tokens, vault, true, { josa: opts.josa ?? true, encode: identity }).out;
}
