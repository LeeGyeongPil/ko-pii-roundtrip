// AC-8: 패키지 메타 — exports 조건, engines, .nvmrc, 선택 peer, 런타임 의존 0, lockfile 라이선스 허용 목록.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')) as {
  name: string;
  type: string;
  license: string;
  engines: { node: string };
  exports: Record<string, Record<string, { types: string; default: string }> | string>;
  peerDependencies: Record<string, string>;
  peerDependenciesMeta: Record<string, { optional: boolean }>;
  dependencies?: Record<string, string>;
  devDependencies: Record<string, string>;
  files: string[];
  scripts: Record<string, string>;
};
const lock = JSON.parse(readFileSync(join(repo, 'package-lock.json'), 'utf8')) as {
  packages: Record<string, { license?: string; version?: string }>;
};

const ALLOWED = new Set(['MIT', 'Apache-2.0', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'BlueOak-1.0.0', 'CC0-1.0', 'Python-2.0']);

/** SPDX 식: 'A OR B' 는 하나만 허용 목록이면 되고, 'A AND B' 는 모두 허용 목록이어야 한다 */
function licenseAllowed(expr: string | undefined): boolean {
  if (expr === undefined || expr.trim() === '') return false; // 불명은 배제
  const e = expr.replace(/[()]/g, '').trim();
  if (e.includes(' OR ')) return e.split(' OR ').some((x) => licenseAllowed(x));
  if (e.includes(' AND ')) return e.split(' AND ').every((x) => licenseAllowed(x));
  return ALLOWED.has(e);
}

describe('AC-8 패키지 메타', () => {
  it.each(['.', './ai-sdk', './openai'])('exports[%s] 에 import·require·default 조건과 types 가 있고 파일이 빌드돼 있다', (entry) => {
    const conds = pkg.exports[entry];
    expect(typeof conds).toBe('object');
    const c = conds as Record<string, { types: string; default: string }>;
    expect(Object.keys(c)).toEqual(['import', 'require', 'default']);
    for (const cond of ['import', 'require', 'default']) {
      const target = c[cond];
      expect(target?.types).toMatch(/\.d\.[mc]ts$/);
      expect(target?.default).toMatch(/\.[mc]js$/);
      // types 가 default 보다 먼저 와야 TypeScript 가 맞게 고른다
      expect(Object.keys(target ?? {})[0]).toBe('types');
      expect(existsSync(join(repo, target?.types ?? '')), target?.types).toBe(true);
      expect(existsSync(join(repo, target?.default ?? '')), target?.default).toBe(true);
    }
    expect(c.require?.default.endsWith('.cjs')).toBe(true);
    expect(c.import?.default.endsWith('.mjs')).toBe(true);
  });

  it('engines.node 는 ">=22.12", .nvmrc 는 22', () => {
    expect(pkg.engines.node).toBe('>=22.12');
    expect(readFileSync(join(repo, '.nvmrc'), 'utf8').trim()).toBe('22');
  });

  it('ai·openai 는 선택 peer(^7.0.0), 런타임 dependencies 는 비어 있다', () => {
    expect(pkg.peerDependencies).toEqual({ ai: '^7.0.0', openai: '^7.0.0' });
    expect(pkg.peerDependenciesMeta).toEqual({ ai: { optional: true }, openai: { optional: true } });
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
  });

  it('devDependencies 는 정확한 버전으로 고정돼 있다', () => {
    for (const [name, range] of Object.entries(pkg.devDependencies)) {
      expect(range, name).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('package-lock 의 모든 패키지 라이선스가 허용 목록 안이다(불명 0)', () => {
    const bad = Object.entries(lock.packages)
      .filter(([path]) => path !== '')
      .filter(([, meta]) => !licenseAllowed(meta.license))
      .map(([path, meta]) => `${path} (${meta.license ?? '불명'})`);
    expect(bad).toEqual([]);
    expect(Object.keys(lock.packages).length).toBeGreaterThan(10);
  });

  it('이름에 ai-lab- 접두가 없고 MIT, 배포 파일 목록과 게시 준비 스크립트가 있다', () => {
    expect(pkg.name).toBe('ko-pii-roundtrip');
    expect(pkg.name.startsWith('ai-lab-')).toBe(false);
    expect(pkg.license).toBe('MIT');
    expect(pkg.files).toContain('dist');
    expect(pkg.scripts.prepublishOnly).toBe('npm test');
    expect(pkg.scripts.test).toContain('vitest run');
  });

  it('SPDX 판정 자체 점검', () => {
    expect(licenseAllowed('(AFL-2.1 OR BSD-3-Clause)')).toBe(true);
    expect(licenseAllowed('MPL-2.0')).toBe(false);
    expect(licenseAllowed('MIT AND GPL-3.0')).toBe(false);
    expect(licenseAllowed(undefined)).toBe(false);
  });
});
