// 도구 호출 인자(JSON 문자열)용 복원기.
//
// 모델이 lookup_customer({"name":"[이름_1]"}) 를 부르면 인자는 JSON 글이다.
// 원래 값에 따옴표·역슬래시가 있으면(예: 김"가명) 그대로 끼워 넣을 때 JSON 이 깨지므로,
// JSON 문자열 이스케이프를 한 값을 넣는다.

import { createRestorerCore } from './stream';
import type { RestoreOptions, StreamRestorer, Vault } from './types';

/** JSON 문자열 리터럴 안에 넣을 수 있도록 이스케이프(앞뒤 따옴표는 뺀다) */
function encodeJsonStringContent(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

/** 도구 인자 조각(tool-input-delta, tool_calls[].function.arguments)용 스트리밍 복원기 */
export function createJsonStringRestorer(vault: Vault, opts: RestoreOptions = {}): StreamRestorer {
  return createRestorerCore(vault, { josa: opts.josa ?? true, encode: encodeJsonStringContent });
}

/** 완성된 JSON 글 하나를 복원한다(스트리밍이 아닌 응답의 도구 인자) */
export function restoreJsonText(json: string, vault: Vault, opts: RestoreOptions = {}): string {
  const r = createJsonStringRestorer(vault, opts);
  return r.push(json) + r.flush();
}
