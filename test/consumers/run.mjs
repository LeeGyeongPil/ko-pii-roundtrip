// 소비자 회귀 검사(AC-7). vitest 밖에서도(CI 의 여러 Node 버전) 그대로 돈다:
//   npm run build && node test/consumers/run.mjs
//
// 1. 빌드된 패키지를 `npm pack` 으로 tarball 로 만든다(실제 배포물과 같은 파일 목록).
//    레포를 그대로 pack 하지 않고, node_modules·.git 을 뺀 복사본에서 pack 의 수명 주기 스크립트
//    (prepare·prepack·postpack)를 지운 뒤 pack 한다. 이유: npm 10(Node 22·22.12 에 딸린 npm)은 폴더를
//    pack 할 때 --ignore-scripts 를 줘도 prepare(= npm run build)를 돌린다. 그러면 ① 빌드 로그가
//    --json 출력 앞에 섞여 JSON 이 깨지고 ② 다른 테스트가 읽는 중인 dist 를 tsdown 이 지웠다 다시 쓰며
//    ③ 빌드 도구가 지원하지 않는 Node(22.12)로 빌드를 시도한다. npm 11 은 이 문제가 없다.
// 2. os.tmpdir() 아래 임시 프로젝트 3개를 만든다.
//    - esm  ("type": "module")   : import 로 '.', './ai-sdk', './openai' + ai·openai 와 함께 왕복 실행
//    - cjs  ("type": "commonjs") : require 로 같은 일. require('ai') 는 Node 22.12+ 의 require(esm)
//    - bare (ai·openai 없음)      : 선택 peer 가 없어도 세 진입점이 모두 불러와지는지
// 3. 설치는 `npm install --offline --ignore-scripts` + 임시 npm 캐시. ai·openai 는 레포 node_modules 로 심볼릭 링크.
// 4. .mts / .cts 소비 코드를 `tsc --module nodenext --noEmit` 로 타입 검사.
// 네트워크를 쓰지 않고, 끝나면 임시 폴더를 지운다.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
// 지금 도는 Node 에 딸린 npm 을 쓴다(공식 배포·setup-node 의 배치: <prefix>/lib/node_modules/npm).
// PATH 의 npm 은 다른 Node 의 것일 수 있어서(예: Node 22 로 테스트하는데 PATH 에는 npm 11) CI 와 결과가 달라진다.
// 그런 배치가 아니면(Homebrew·Windows 등) PATH 의 npm 으로 돌아간다.
const bundledNpm = join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
const npmCmd = existsSync(bundledNpm) ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmPrefix = existsSync(bundledNpm) ? [bundledNpm] : [];

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** npm 실행(위에서 고른 npm) */
function npm(args, cwd) {
  return run(npmCmd, [...npmPrefix, ...args], cwd);
}

function project(name, type, linkPeers) {
  const dir = join(tmp, name);
  mkdirSync(dir);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `consumer-${name}`, private: true, type }, null, 2));
  npm(['install', '--offline', '--ignore-scripts', '--no-package-lock', tarball], dir);
  if (linkPeers) {
    for (const peer of ['ai', 'openai']) symlinkSync(join(repo, 'node_modules', peer), join(dir, 'node_modules', peer), 'junction');
  }
  return dir;
}

/** pack 할 때 npm 이 돌리는 수명 주기 스크립트 — 복사본에서 지운다(위 1번 설명) */
const PACK_LIFECYCLE = ['prepare', 'prepack', 'postpack', 'prepublish'];

/** 레포 복사본(node_modules·.git 제외, dist 포함)을 만들고 pack 수명 주기 스크립트를 지운다 */
function stageForPack() {
  const stage = join(tmp, 'stage');
  cpSync(repo, stage, {
    recursive: true,
    filter: (src) => {
      const rel = src.slice(repo.length + 1).split(/[\\/]/)[0];
      return rel !== 'node_modules' && rel !== '.git';
    },
  });
  const pkgPath = join(stage, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  for (const name of PACK_LIFECYCLE) delete pkg.scripts?.[name];
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  return stage;
}

/** npm pack --json 출력 해석. 스크립트 로그가 섞이면 무엇이 섞였는지 보여 주고 실패한다 */
function parsePackJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`npm pack --json 출력이 JSON 이 아닙니다(스크립트 로그가 섞였을 수 있음):\n${stdout.slice(0, 400)}`);
  }
}

let tarball = '';
let failed = false;
try {
  // 1) tarball — 복사본에서 pack 해 레포의 dist 를 건드리지 않는다
  console.log(`NODE ${process.version} NPM ${npm(['--version'], repo).trim()}`);
  const stage = stageForPack();
  const packDir = join(tmp, 'pack');
  mkdirSync(packDir);
  const packed = parsePackJson(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', packDir], stage));
  tarball = join(packDir, packed[0].filename);
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
