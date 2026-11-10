// ai·openai 가 없는 프로젝트에서 우리 d.ts 를 skipLibCheck:false 로 엄격하게 타입 검사한다. 실행하지 않는다.
import {
  attachJosa,
  createJsonStringRestorer,
  createVault,
  detect,
  detectors,
  KoPiiError,
  pseudonymize,
  restore,
  UnknownDetectorError,
  type Detector,
  type JosaPair,
  type PiiKind,
} from 'ko-pii-roundtrip';
import { wrapOpenAI, type OpenAILike } from 'ko-pii-roundtrip/openai';

type IsAny<T> = 0 extends 1 & T ? true : false;
// 타입이 any 로 무너지면(선언 파일이 깨지면) 여기서 오류가 난다
const vaultNotAny: IsAny<ReturnType<typeof createVault>> extends true ? never : true = true;

const custom: Detector = { kind: 'employee', label: '사번', find: () => [] };
const kinds: PiiKind[] = Object.keys(detectors) as PiiKind[];
const pair: JosaPair = '으로/로';
const v = createVault();
const out: string = restore(pseudonymize('x', v, { detectors: ['phone', custom] }), v);
const j: string = createJsonStringRestorer(v).flush();
const n: number = detect('x').length;
const e: KoPiiError = new UnknownDetectorError('x', []);
const fake: OpenAILike = { chat: { completions: { create: () => null } } };
const wrapped: OpenAILike = wrapOpenAI(fake, { vault: v, josa: false });

export { vaultNotAny, kinds, pair, out, j, n, e, wrapped, attachJosa };
