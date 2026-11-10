// 보류 버퍼(holdback) 스트리밍 복원기.
//
// 모델 답은 '[이름' + '_1]은 ' 처럼 아무 데서나 쪼개져 온다. 조각마다 따로 바꾸면
// 가명 조각이 그대로 화면에 새고, 조사도 고칠 수 없다.
// 그래서 "뒤 조각을 봐야 판단할 수 있는 꼬리"만 버퍼에 남겨 두고, 나머지는 바로 내보낸다.
// 남겨 두는 꼬리는 가장 긴 가명 + 조사 두 글자 + 경계 한 글자를 넘지 않는다.

import { scan } from './restore';
import { assertText, assertVault } from './validate';
import type { RestoreOptions, StreamRestorer, Vault } from './types';

export interface RestorerCoreOptions {
  josa: boolean;
  encode: (value: string) => string;
}

/** stream.ts 와 json-stream.ts 가 같이 쓰는 뼈대 */
export function createRestorerCore(vault: Vault, opts: RestorerCoreOptions): StreamRestorer {
  assertVault(vault, 'the stream restorer');
  let buffer = '';
  let tokens: string[] = [];
  let tokensForSize = -1;

  function currentTokens(): string[] {
    // 스트림 도중 vault 가 커질 수도 있으므로 크기가 바뀌면 다시 읽는다
    if (tokensForSize !== vault.size) {
      tokens = vault.tokens();
      tokensForSize = vault.size;
    }
    return tokens;
  }

  return {
    push(delta: string): string {
      assertText(delta, 'StreamRestorer.push(delta)');
      buffer += delta;
      const r = scan(buffer, currentTokens(), vault, false, opts);
      buffer = buffer.slice(r.consumed); // 판단을 미룬 꼬리만 남긴다
      return r.out;
    },
    flush(): string {
      const r = scan(buffer, currentTokens(), vault, true, opts);
      buffer = '';
      return r.out;
    },
  };
}

/**
 * 스트리밍 복원기를 만든다. 텍스트 블록 하나(AI SDK 의 text id 하나, openai 의 choice 하나)마다
 * 하나씩 만들고, 블록이 끝나면(또는 스트림이 끝나면) 반드시 flush() 를 부른다.
 */
export function createStreamRestorer(vault: Vault, opts: RestoreOptions = {}): StreamRestorer {
  assertVault(vault, 'createStreamRestorer(vault)');
  return createRestorerCore(vault, { josa: opts.josa ?? true, encode: (v) => v });
}
