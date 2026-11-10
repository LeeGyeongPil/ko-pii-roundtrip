// CJS(.cts) 소비 코드 타입 검사용 — require 조건의 .d.cts 타입을 쓴다. 실행하지 않는다.
import kpr = require('ko-pii-roundtrip');
import aiSdk = require('ko-pii-roundtrip/ai-sdk');
import oa = require('ko-pii-roundtrip/openai');
import OpenAI = require('openai');

const vault: kpr.Vault = kpr.createVault();
const sent: string = kpr.pseudonymize('고객 이예시님', vault);
const back: string = kpr.restore(sent, vault);
const json = kpr.createJsonStringRestorer(vault);
const piece: string = json.push('{"a":"[이름_1]"}') + json.flush();
const mw: aiSdk.PiiMiddleware = aiSdk.piiMiddleware({ vault });
const spec: 'v4' = mw.specificationVersion;
const client = oa.wrapOpenAI(new OpenAI.OpenAI({ apiKey: 'mock' }), { vault });
const batchim: boolean | null = kpr.hasBatchim('김가명');
let err: kpr.KoPiiError | undefined;

// 'ai' 타입을 못 찾아 PiiMiddleware 가 any 로 무너지면 여기서 오류가 난다
type IsAny<T> = 0 extends 1 & T ? true : false;
const mwNotAny: IsAny<aiSdk.PiiMiddleware> extends true ? never : true = true;

export = { back, piece, spec, client, batchim, err, mwNotAny };
