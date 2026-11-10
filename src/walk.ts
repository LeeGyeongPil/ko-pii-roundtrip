// JSON 같은 값(객체·배열·문자열) 안의 모든 문자열 값에 함수를 적용한다.
// 도구 호출 인자·도구 결과처럼 구조가 있는 값을 가명 처리/복원할 때 쓴다. 키는 건드리지 않는다.

export function mapStrings(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value !== null && typeof value === 'object') {
    // 평범한 객체만 복사한다(Date·Uint8Array 등은 그대로 둔다)
    const proto = Object.getPrototypeOf(value) as unknown;
    if (proto !== Object.prototype && proto !== null) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = mapStrings(v, fn);
    return out;
  }
  return value;
}

/** JSON 글이면 파싱해서 문자열 값만 바꾼 뒤 다시 JSON 으로. JSON 이 아니면 글 전체에 fn 적용 */
export function mapJsonText(json: string, fn: (s: string) => string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return fn(json);
  }
  return JSON.stringify(mapStrings(parsed, fn));
}
