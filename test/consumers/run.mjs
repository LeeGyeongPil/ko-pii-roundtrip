// 소비자 회귀 검사(AC-7). vitest 밖에서도(CI 의 여러 Node 버전) 그대로 돈다:
//   npm run build && node test/consumers/run.mjs
//
// 1. 빌드된 패키지를 `npm pack --ignore-scripts` 로 tarball 로 만든다(실제 배포물과 같은 파일 목록).
// 2. os.tmpdir() 아래 임시 프로젝트 3개를 만든다.
//    - esm  ("type": "module")   : import 로 '.', './ai-sdk', './openai' + ai·openai 와 함께 왕복 실행
//    - cjs  ("type": "commonjs") : require 로 같은 일. require('ai') 는 Node 22.12+ 의 require(esm)
//    - bare (ai·openai 없음)      : 선택 peer 가 없어도 세 진입점이 모두 불러와지는지
// 3. 설치는 `npm install --offline --ignore-scripts` + 임시 npm 캐시. ai·openai 는 레포 node_modules 로 심볼릭 링크.
// 4. .mts / .cts 소비 코드를 `tsc --module nodenext --noEmit` 로 타입 검사.
// 네트워크를 쓰지 않고, 끝나면 임시 폴더를 지운다.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const fixtures = join(here, 'fixtures');

if (!existsSync(join(repo, 'dist', 'index.mjs'))) {
  console.error('dist 가 없습니다. 먼저 npm run build 를 실행하세요.');
  process.exit(2);
}

const tmp = mkdtempSync(join(tmpdir(), 'ko-pii-consumers-'));
const env = {
  ...process.env,
  npm_config_cache: join(tmp, 'npm-cache'), // 사용자 캐시를 건드리지 않는다
  npm_config_update_notifier: 'false',
  npm_config_audit: 'false',
  npm_config_fund: 'false',
};
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function project(name, type, linkPeers) {
  const dir = join(tmp, name);
  mkdirSync(dir);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `consumer-${name}`, private: true, type }, null, 2));
  run(npm, ['install', '--offline', '--ignore-scripts', '--no-package-lock', tarball], dir);
  if (linkPeers) {
    for (const peer of ['ai', 'openai']) symlinkSync(join(repo, 'node_modules', peer), join(dir, 'node_modules', peer), 'junction');
  }
  return dir;
}

let tarball = '';
let failed = false;
try {
  // 1) tarball
  const packed = JSON.parse(run(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', tmp], repo));
  tarball = join(tmp, packed[0].filename);
  const files = packed[0].files.map((f) => f.path);
  console.log(`PACK ${packed[0].filename} files=${files.length}`);
  for (const f of files) {
    if (!/^(dist\/|package\.json$|README\.md$|LICENSE$|CHANGELOG\.md$)/.test(f)) throw new Error(`tarball 에 예상 밖 파일: ${f}`);
  }

  // 2~3) 실행 검사
  const esm = project('esm', 'module', true);
  writeFileSync(join(esm, 'consumer.mjs'), readFileSync(join(fixtures, 'consumer.mjs')));
  process.stdout.write(run(process.execPath, ['consumer.mjs'], esm));

  const cjs = project('cjs', 'commonjs', true);
  writeFileSync(join(cjs, 'consumer.cjs'), readFileSync(join(fixtures, 'consumer.cjs')));
  process.stdout.write(run(process.execPath, ['consumer.cjs'], cjs));

  const bare = project('bare', 'module', false);
  writeFileSync(join(bare, 'bare.mjs'), readFileSync(join(fixtures, 'bare.mjs')));
  writeFileSync(join(bare, 'bare.cjs'), readFileSync(join(fixtures, 'bare.cjs')));
  process.stdout.write(run(process.execPath, ['bare.mjs'], bare));
  process.stdout.write(run(process.execPath, ['bare.cjs'], bare));

  // 4) 타입 검사(.mts 는 esm 프로젝트, .cts 는 cjs 프로젝트)
  const tsc = join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
  // skipLibCheck: ai·@ai-sdk/provider 의 d.ts 는 json-schema 타입 등을 따로 요구하므로 esm·cjs 는 true.
  // 대신 ai 가 없는 bare 프로젝트에서 우리 d.ts(코어·openai)를 skipLibCheck:false 로 엄격하게 본다.
  const tsconfig = (file, skipLibCheck) =>
    JSON.stringify({
      compilerOptions: {
        module: 'nodenext',
        moduleResolution: 'nodenext',
        target: 'es2022',
        lib: ['es2023', 'dom'],
        strict: true,
        noEmit: true,
        types: [],
        skipLibCheck,
      },
      files: [file],
    });
  const typecheck = (dir, file, skipLibCheck) => {
    writeFileSync(join(dir, file), readFileSync(join(fixtures, file)));
    writeFileSync(join(dir, 'tsconfig.json'), tsconfig(file, skipLibCheck));
    run(process.execPath, [tsc, '-p', 'tsconfig.json'], dir);
  };
  typecheck(esm, 'consumer.mts', true);
  typecheck(cjs, 'consumer.cts', true);
  typecheck(bare, 'bare-types.mts', false);
  console.log('CONSUMER_TYPES_OK errors=0');
} catch (err) {
  failed = true;
  const e = /** @type {{ message?: string, stdout?: string, stderr?: string }} */ (err);
  console.error('CONSUMER_FAIL', e.message);
  if (e.stdout) console.error(String(e.stdout));
  if (e.stderr) console.error(String(e.stderr));
} finally {
  rmSync(tmp, { recursive: true, force: true }); // 임시 프로젝트·캐시·tarball 정리
}
process.exit(failed ? 1 : 0);
