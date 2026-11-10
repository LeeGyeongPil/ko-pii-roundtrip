// ESM(.mts) 소비 코드 타입 검사용 — tsc --module nodenext --noEmit 로 검사만 하고 실행하지 않는다.
import { createVault, detect, pseudonymize, restore, createStreamRestorer, type Detection, type Vault } from 'ko-pii-roundtrip';
import { piiMiddleware } from 'ko-pii-roundtrip/ai-sdk';
import { wrapOpenAI } from 'ko-pii-roundtrip/openai';
import { wrapLanguageModel, type LanguageModel } from 'ai';
import OpenAI from 'openai';

declare const base: Exclude<LanguageModel, string>;

const vault: Vault = createVault({ labels: { name: 'NAME' } });
const found: Detection[] = detect('성명: 김가명', { detectors: ['name', 'phone'], names: ['박샘플'] });
const sent: string = pseudonymize('성명: 김가명', vault);
const back: string = restore(sent, vault, { josa: true });
const r = createStreamRestorer(vault);
const piece: string = r.push('[NAME_') + r.flush();

const model = wrapLanguageModel({ model: base as never, middleware: piiMiddleware({ vault, restoreReasoning: false }) });
const client: OpenAI = wrapOpenAI(new OpenAI({ apiKey: 'mock' }), { vault });

// 'ai' 타입을 못 찾아 미들웨어 타입이 any 로 무너지면 여기서 오류가 난다
type IsAny<T> = 0 extends 1 & T ? true : false;
const mwNotAny: IsAny<ReturnType<typeof piiMiddleware>> extends true ? never : true = true;

export { found, back, piece, model, client, mwNotAny };
