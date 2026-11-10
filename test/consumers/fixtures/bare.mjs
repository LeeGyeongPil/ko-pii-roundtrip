// ai·openai 를 설치하지 않은 ESM 프로젝트: 세 진입점이 모두 불러와져야 한다(선택 peer, 타입으로만 참조).
import assert from 'node:assert/strict';
import { createVault, pseudonymize, restore } from 'ko-pii-roundtrip';
import { piiMiddleware } from 'ko-pii-roundtrip/ai-sdk';
import { wrapOpenAI } from 'ko-pii-roundtrip/openai';

const vault = createVault();
const text = '성명: 김가명, 연락처 010-0000-5678';
assert.equal(restore(pseudonymize(text, vault), vault), text);
assert.equal(typeof piiMiddleware({ vault }).wrapStream, 'function');
assert.equal(typeof wrapOpenAI, 'function');
console.log('CONSUMER_BARE_ESM_OK');
