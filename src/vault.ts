// Vault: 원래 값 ↔ 가명 표. 메모리에만 있고, 수명은 앱이 정하는 "대화 하나".

import { KoPiiError } from './errors';
import { optionKeys, type PiiKind, type Vault } from './types';
import { assertKnownKeys } from './validate';

/** 기본 라벨. 가명은 `[라벨_번호]` 꼴이 된다 */
export const DEFAULT_LABELS: Readonly<Record<PiiKind, string>> = {
  rrn: '주민번호',
  frn: '외국인번호',
  brn: '사업자번호',
  phone: '전화',
  card: '카드',
  account: '계좌',
  email: '이메일',
  name: '이름',
};

export interface VaultOptions {
  labels?: Partial<Record<PiiKind, string>>;
}

/** Keys accepted by createVault() (kept in sync with VaultOptions by the type check). */
const VAULT_OPTION_KEYS = optionKeys<VaultOptions>({ labels: true });

/** 라이브러리 내부(pseudonymize)만 쓰는 통로 */
export interface VaultInternal {
  /** 이미 아는 원래 값과 그 kind 목록(긴 값부터) */
  knownValues(): Array<{ kind: string; value: string }>;
}

// Symbol.for 를 쓰는 이유: ESM 과 CJS 빌드가 한 앱에 같이 올라와도(이중 패키지)
// 두 빌드가 같은 키를 보게 하려고. 모듈 전역 WeakMap 이면 빌드마다 따로 생긴다.
const INTERNAL_KEY: symbol = Symbol.for('ko-pii-roundtrip.vault.internal');

function checkLabel(label: string): void {
  // 가명 경계를 '[' ']' 로 판정하므로 라벨 안에는 넣을 수 없다
  if (label.length === 0 || /[[\]\s]/.test(label)) {
    throw new KoPiiError(`라벨에는 빈 문자열·공백·대괄호를 쓸 수 없습니다: '${label}'`);
  }
}

export function createVault(opts: VaultOptions = {}): Vault {
  assertKnownKeys(opts, VAULT_OPTION_KEYS, 'createVault(options)');
  const labels: Record<string, string> = { ...DEFAULT_LABELS, ...opts.labels };
  for (const label of Object.values(labels)) checkLabel(label);

  const tokenByValue = new Map<string, string>(); // 원래 값 → 가명
  const valueByToken = new Map<string, string>(); // 가명 → 원래 값
  const kindByValue = new Map<string, string>();
  const counter = new Map<string, number>(); // 라벨별 다음 번호
  let sortedTokens: string[] | null = null; // tokens() 캐시

  const vault: Vault = {
    tokenFor(kind: string, value: string, label?: string): string {
      const known = tokenByValue.get(value);
      if (known !== undefined) return known; // 같은 값은 대화 내내 같은 가명
      const useLabel = label ?? labels[kind] ?? kind;
      checkLabel(useLabel);
      const n = (counter.get(useLabel) ?? 0) + 1;
      counter.set(useLabel, n);
      const token = `[${useLabel}_${n}]`;
      tokenByValue.set(value, token);
      valueByToken.set(token, value);
      kindByValue.set(value, kind);
      sortedTokens = null;
      return token;
    },
    original(token: string): string | undefined {
      return valueByToken.get(token);
    },
    get size(): number {
      return valueByToken.size;
    },
    tokens(): string[] {
      // 긴 가명부터: 한 번 훑기 복원에서 긴 것을 먼저 맞춰 본다
      sortedTokens ??= [...valueByToken.keys()].sort((a, b) => b.length - a.length);
      return [...sortedTokens];
    },
    toJSON(): { redacted: true; size: number } {
      return { redacted: true, size: valueByToken.size };
    },
  };

  const internal: VaultInternal = {
    knownValues(): Array<{ kind: string; value: string }> {
      return [...tokenByValue.keys()]
        .sort((a, b) => b.length - a.length)
        .map((value) => ({ kind: kindByValue.get(value) ?? 'unknown', value }));
    },
  };
  // 열거되지 않는 속성이라 JSON.stringify·Object.keys·console.log 에 안 보인다
  Object.defineProperty(vault, INTERNAL_KEY, { value: internal, enumerable: false });
  return vault;
}

/** 내부 통로를 꺼낸다. createVault() 가 만든 vault 가 아니면 null(assertVault 가 이것으로 진짜 vault 인지 본다) */
export function vaultInternal(vault: Vault): VaultInternal | null {
  const found = (vault as unknown as Record<symbol, unknown>)[INTERNAL_KEY];
  if (typeof found === 'object' && found !== null && 'knownValues' in found) {
    return found as VaultInternal;
  }
  return null;
}
