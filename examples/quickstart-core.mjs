// 코어만 쓰는 최소 예제: 탐지 → 가명 → 복원 (네트워크·키 불필요)
import { createVault, detect, pseudonymize, restore } from 'ko-pii-roundtrip';

const vault = createVault(); // 대화 하나당 vault 하나(메모리 전용)
const memo = '고객 이예시님(010-0000-1234)이 환불 요청. 주민 990101-3000012, 국민은행 000-000-001234';

for (const d of detect(memo)) console.log(d.kind, JSON.stringify(d.value), d.confidence);

const sent = pseudonymize(memo, vault);
console.log(sent); // 모델에는 이 글만 보낸다
console.log(JSON.stringify(vault)); // 원래 값은 찍히지 않는다

const answer = '[이름_1]은 [전화_1]으로 연락하고 [계좌_1]로 환불합니다.'; // 모델 답이라고 가정
console.log(restore(answer, vault));
console.log(restore(answer, vault, { josa: false }));
