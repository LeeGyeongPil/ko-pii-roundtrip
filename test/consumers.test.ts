// AC-7: ESM·CJS 소비자 회귀. 실제 배포물(npm pack tarball)을 임시 프로젝트에 설치해 import/require 로
// 왕복 실행하고 .mts/.cts 소비 코드를 tsc(nodenext)로 검사한다. 본체는 test/consumers/run.mjs
// (CI 에서는 Node 22.12.0·24·26 에서 같은 스크립트를 직접 돌린다).

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

it('AC-7 tarball 을 ESM·CJS·peer 없는 프로젝트에 설치해 실행하고 타입 검사한다', () => {
  const r = spawnSync(process.execPath, [join(repo, 'test', 'consumers', 'run.mjs')], { cwd: repo, encoding: 'utf8', timeout: 180_000 });
  const output = `${r.stdout}\n${r.stderr}`;
  console.log(r.stdout.trim());
  expect(r.status, output).toBe(0);
  for (const marker of ['CONSUMER_ESM_OK', 'CONSUMER_CJS_OK', 'CONSUMER_BARE_ESM_OK', 'CONSUMER_BARE_CJS_OK', 'CONSUMER_TYPES_OK errors=0']) {
    expect(output).toContain(marker);
  }
}, 200_000);
