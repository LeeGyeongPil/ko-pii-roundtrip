// AC-7: ESM·CJS 소비자 회귀. 실제 배포물(npm pack tarball)을 임시 프로젝트에 설치해 import/require 로
// 왕복 실행하고 .mts/.cts 소비 코드를 tsc(nodenext)로 검사한다. 본체는 test/consumers/run.mjs
// (CI 에서는 Node 22.12.0·24·26 에서 같은 스크립트를 직접 돌린다).

import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

/** dist 파일별 수정 시각 — pack 이 몰래 다시 빌드하면(npm 10 의 prepare) 바뀐다 */
function distSnapshot(): Record<string, number> {
  const dist = join(repo, 'dist');
  return Object.fromEntries(readdirSync(dist).map((f) => [f, statSync(join(dist, f)).mtimeMs]));
}

it('AC-7 tarball 을 ESM·CJS·peer 없는 프로젝트에 설치해 실행하고 타입 검사한다', () => {
  const before = distSnapshot();
  const r = spawnSync(process.execPath, [join(repo, 'test', 'consumers', 'run.mjs')], { cwd: repo, encoding: 'utf8', timeout: 180_000 });
  const output = `${r.stdout}\n${r.stderr}`;
  console.log(r.stdout.trim());
  expect(r.status, output).toBe(0);
  for (const marker of ['CONSUMER_ESM_OK', 'CONSUMER_CJS_OK', 'CONSUMER_BARE_ESM_OK', 'CONSUMER_BARE_CJS_OK', 'CONSUMER_TYPES_OK errors=0']) {
    expect(output).toContain(marker);
  }
  // 소비자 검사는 레포의 dist 를 읽기만 한다. 다시 빌드하면 같은 때 도는 다른 테스트(예제·exports 검사)가
  // 지워지는 중인 dist 를 볼 수 있다
  expect(distSnapshot()).toEqual(before);
}, 200_000);
