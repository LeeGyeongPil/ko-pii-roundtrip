// CommonJS 에서 쓰기 — Node 22.12+ 는 require() 로 ESM 패키지(ai)도 불러온다
const { createVault, pseudonymize, restore } = require('ko-pii-roundtrip');
const { piiMiddleware } = require('ko-pii-roundtrip/ai-sdk');
const { wrapLanguageModel } = require('ai');

const vault = createVault();
const sent = pseudonymize('고객 이예시님(010-0000-1234)이 환불 요청', vault);
console.log(sent);
console.log(restore('[이름_1]은 [전화_1]으로 연락드립니다.', vault));
console.log(typeof wrapLanguageModel, typeof piiMiddleware);
