// 공개 타입 모음. 여러 파일이 같이 쓰므로 한곳에 둔다.

/** 기본 제공 탐지기 8종의 이름 */
export type PiiKind = 'rrn' | 'frn' | 'brn' | 'phone' | 'card' | 'account' | 'email' | 'name';

/**
 * 탐지 신뢰도.
 * - checksum: 형식 + 체크섬까지 맞음
 * - format: 형식(과 날짜·성별 자리 같은 구조 규칙)만 맞음
 * - context: 주변 낱말(은행명·호칭·사용자 사전) 덕분에 찾음
 */
export type Confidence = 'checksum' | 'format' | 'context';

export interface Detection {
  kind: PiiKind | (string & {});
  value: string;
  /** text 안 시작 위치(UTF-16 코드 단위) */
  start: number;
  /** 끝 위치(포함하지 않음) */
  end: number;
  confidence: Confidence;
}

export interface Detector {
  /** 탐지 결과의 kind 로 쓰인다 */
  kind: string;
  /** 가명에 들어갈 라벨. 예: '이름' → [이름_1] */
  label: string;
  find(text: string): Detection[];
}

export interface DetectOptions {
  /** 켤 탐지기. 이름 또는 사용자 정의 탐지기 객체. 생략하면 기본 8종 전부 */
  detectors?: Array<PiiKind | Detector>;
  /** 이름 탐지기에 더할 사용자 사전(문맥 없이도 이름으로 본다) */
  names?: string[];
}

/**
 * Build the runtime list of option keys from a record that must name every key of T exactly once.
 * Adding a key to the interface makes the record fail to type-check until the key is added here too.
 */
export function optionKeys<T>(record: Record<keyof T, true>): readonly string[] {
  return Object.keys(record);
}

/** Keys accepted by detect() / pseudonymize() (kept in sync with DetectOptions by the type check). */
export const DETECT_OPTION_KEYS: readonly string[] = optionKeys<DetectOptions>({ detectors: true, names: true });

/** 값 ↔ 가명 표. createVault() 로만 만든다(직접 구현한 객체는 KoPiiError) */
export interface Vault {
  /** 값의 가명을 돌려준다. 처음 보는 값이면 라벨별 다음 번호로 새로 만든다 */
  tokenFor(kind: string, value: string, label?: string): string;
  /** 가명 → 원래 값. 모르는 가명이면 undefined */
  original(token: string): string | undefined;
  readonly size: number;
  /** 지금까지 만든 가명 목록(긴 것부터) */
  tokens(): string[];
  /** 로그·직렬화로 원래 값이 새지 않도록 개수만 내보낸다 */
  toJSON(): { redacted: true; size: number };
}

/** 조사 쌍. 앞이 받침 있을 때, 뒤가 받침 없을 때 */
export type JosaPair = '은/는' | '이/가' | '을/를' | '과/와' | '으로/로' | '이랑/랑';

export interface RestoreOptions {
  /** 복원한 값의 받침에 맞게 바로 뒤 조사를 고칠지(기본 true) */
  josa?: boolean;
}

/** 스트리밍 복원기. push 로 조각을 넣고 마지막에 flush 를 한 번 부른다 */
export interface StreamRestorer {
  push(delta: string): string;
  flush(): string;
}
