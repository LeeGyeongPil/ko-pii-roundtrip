// AC-9: 연습용 목 예제(npm run example 이 실행하는 examples/demo.mjs)가 약속한 줄을 출력하고 0 으로 끝나는지.
// npm test 가 먼저 빌드하므로 여기서는 node 로 바로 실행한다.

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

it('AC-9 데모: LEAK 0, NAIVE_BROKEN yes, SPLITS 200/200', () => {
  const r = spawnSync(process.execPath, [join(repo, 'examples', 'demo.mjs')], { cwd: repo, encoding: 'utf8', timeout: 120_000 });
  expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
  expect(r.stdout).toContain('연습용 목(mock) 모드');
  expect(r.stdout).toMatch(/^LEAK 0\b/m);
  expect(r.stdout).toMatch(/^NAIVE_BROKEN yes\b/m);
  expect(r.stdout).toMatch(/^SPLITS 200\/200\b/m);
  expect(r.stdout).toMatch(/^MATCH yes$/m);
}, 130_000);
