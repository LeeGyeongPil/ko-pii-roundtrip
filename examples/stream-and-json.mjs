// 스트리밍 복원기와 JSON 인자 복원기(도구 호출용) 예제 — 네트워크 불필요
import { createJsonStringRestorer, createStreamRestorer, createVault, pseudonymize } from 'ko-pii-roundtrip';

const vault = createVault();
pseudonymize('고객 이예시님(010-0000-1234)', vault); // [이름_1], [전화_1] 이 만들어진다

// 1) 글 스트림: 조각이 가명 한가운데서 끊겨도 된다
const r = createStreamRestorer(vault);
const pieces = ['[이름', '_1]', '은 [전', '화_1]으', '로 연락'];
const out = pieces.map((p) => r.push(p));
out.push(r.flush()); // 스트림이 끝나면 꼭 한 번 부른다
console.log(JSON.stringify(out));
console.log(out.join(''));

// 2) 도구 인자(JSON 문자열) 스트림: 복원한 값이 JSON 을 깨지 않도록 이스케이프해서 넣는다
const quoted = createVault();
quoted.tokenFor('name', '김"가명');
const j = createJsonStringRestorer(quoted);
const args = ['{"name":"[이름', '_1]"}'].map((p) => j.push(p)).join('') + j.flush();
console.log(args);
console.log(JSON.parse(args).name);
