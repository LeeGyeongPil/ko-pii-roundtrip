// 가명 처리: 찾은 개인정보를 vault 의 가명([이름_1] 등)으로 바꾼다.

import { detectRaw, resolveOverlaps, type LabeledDetection } from './detect/index';
import type { DetectOptions, Vault } from './types';
import { assertDetectOptions, assertText, assertVault } from './validate';
import { vaultInternal } from './vault';

/** text 안에 이미 들어 있는 가명 자리(다시 탐지하거나 바꾸지 않는다) */
function existingTokenSpans(text: string, vault: Vault): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  if (!text.includes('[')) return spans;
  for (const token of vault.tokens()) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(token, from);
      if (at === -1) break;
      spans.push([at, at + token.length]);
      from = at + token.length;
    }
  }
  return spans;
}

/** vault 가 이미 아는 원래 값이 글에 그대로 나오면 탐지기와 상관없이 같은 가명으로 바꾼다 */
function knownValueHits(text: string, vault: Vault): LabeledDetection[] {
  const internal = vaultInternal(vault);
  if (internal === null) return [];
  const hits: LabeledDetection[] = [];
  for (const { kind, value } of internal.knownValues()) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(value, from);
      if (at === -1) break;
      hits.push({ kind, value, start: at, end: at + value.length, confidence: 'checksum' });
      from = at + value.length;
    }
  }
  return hits;
}

/**
 * 개인정보를 가명으로 바꾼 글을 돌려준다. 같은 vault 를 쓰면 같은 값은 늘 같은 가명이 된다.
 * 예: pseudonymize('고객 이예시님(010-0000-1234)', vault) → '고객 [이름_1]님([전화_1])'
 */
export function pseudonymize(text: string, vault: Vault, opts: DetectOptions = {}): string {
  assertText(text, 'pseudonymize(text, vault)');
  assertVault(vault, 'pseudonymize(text, vault)');
  assertDetectOptions(opts, 'pseudonymize(text, vault, options)');
  const protectedSpans = existingTokenSpans(text, vault);
  // 1) 다음 턴: 화면에 복원돼 있던 값(이전 답)은 문맥이 없어도 같은 가명으로 되돌린다
  const known = resolveOverlaps(knownValueHits(text, vault), protectedSpans);
  // 2) 나머지 자리에서 탐지
  const taken: Array<[number, number]> = [...protectedSpans, ...known.map((d): [number, number] => [d.start, d.end])];
  const detected = resolveOverlaps(detectRaw(text, opts), taken);

  const spans = [...known, ...detected].sort((a, b) => a.start - b.start);
  let out = '';
  let pos = 0;
  for (const d of spans) {
    out += text.slice(pos, d.start) + vault.tokenFor(d.kind, d.value, d.label);
    pos = d.end;
  }
  return out + text.slice(pos);
}
