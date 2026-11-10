// ai·openai 를 설치하지 않은 프로젝트에서 require 로 세 진입점을 불러온다.
const assert = require('node:assert/strict');
const { createVault, pseudonymize, restore } = require('ko-pii-roundtrip');
const { piiMiddleware } = require('ko-pii-roundtrip/ai-sdk');
const { wrapOpenAI } = require('ko-pii-roundtrip/openai');

const vault = createVault();
const text = '성명: 김가명, 연락처 010-0000-5678';
assert.equal(restore(pseudonymize(text, vault), vault), text);
assert.equal(typeof piiMiddleware({ vault }).wrapStream, 'function');
assert.equal(typeof wrapOpenAI, 'function');
console.log('CONSUMER_BARE_CJS_OK');
