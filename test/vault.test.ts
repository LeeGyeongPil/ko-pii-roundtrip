// AC-2: vault 왕복 — restore(pseudonymize(x)) === x, 대화 내 일관성, 한 번 훑기, 직렬화 가림.

import { describe, expect, it } from 'vitest';
import { createVault, KoPiiError, pseudonymize, restore } from '../src/index';
import { NAMES, SYN } from './fixtures/synthetic';

const ORIGINALS = [
  SYN.rrnChecksumMale,
  SYN.frnChecksum7,
  SYN.brn,
  SYN.card,
  SYN.phone1234,
  SYN.landline,
  SYN.account,
  SYN.email,
  NAMES.lee,
  NAMES.kim,
];

const SENTENCES = [
  `고객 ${NAMES.lee}님(${SYN.phone1234})이 환불을 요청했습니다.`,
  `주민번호 ${SYN.rrnChecksumMale}, 외국인 ${SYN.frnChecksum7}, 사업자 ${SYN.brn}.`,
  `카드 ${SYN.card}로 결제, 국민은행 ${SYN.account}로 입금. 회신은 ${SYN.email}으로.`,
  `${NAMES.kim}고객님과 ${NAMES.lee}님이 ${SYN.landline}로 통화했습니다.`,
  `성명: ${NAMES.kim}\n연락처: ${SYN.phone1234}\n메모: 은행 방문 예정`,
  '개인정보가 없는 글은 그대로 돌아온다. [괄호]도 그대로.',
];

describe('AC-2 vault 왕복', () => {
  it.each(SENTENCES)('restore(pseudonymize(x)) === x: %s', (x) => {
    const vault = createVault();
    const sent = pseudonymize(x, vault);
    for (const v of ORIGINALS) expect(sent).not.toContain(v); // 모델 쪽으로는 원래 값이 하나도 안 간다
    expect(restore(sent, vault)).toBe(x);
  });

  it('같은 값은 3턴 내내 같은 가명이고, 이전 답(복원된 글)도 같은 가명으로 돌아간다', () => {
    const vault = createVault();
    const turn1 = pseudonymize(`고객 ${NAMES.lee}님 ${SYN.phone1234}`, vault);
    expect(turn1).toBe('고객 [이름_1]님 [전화_1]');

    // 2턴: 화면에 복원돼 있던 이전 답. 이름 뒤에 호칭이 없어 탐지기만으로는 못 찾는 꼴이다
    const shownAnswer = restore('[이름_1]은 [전화_1]으로 연락 바랍니다.', vault);
    expect(shownAnswer).toBe(`${NAMES.lee}는 ${SYN.phone1234}로 연락 바랍니다.`);
    const turn2 = pseudonymize(shownAnswer, vault);
    expect(turn2).toBe('[이름_1]는 [전화_1]로 연락 바랍니다.');

    // 3턴: 새 사람이 나오면 다음 번호, 이전 사람은 그대로
    const turn3 = pseudonymize(`${NAMES.kim}님과 ${NAMES.lee}님, ${SYN.phone1234}`, vault);
    expect(turn3).toBe('[이름_2]님과 [이름_1]님, [전화_1]');
    expect(vault.size).toBe(3);
  });

  it('원래 값이 다른 가명 문자열과 같아도 두 번 바뀌지 않는다(한 번 훑기)', () => {
    const vault = createVault();
    const t1 = vault.tokenFor('name', '[이름_2]'); // 원래 값 자체가 가명처럼 생겼다
    const t2 = vault.tokenFor('name', NAMES.park);
    expect([t1, t2]).toEqual(['[이름_1]', '[이름_2]']);
    // 순서대로 replace 했다면 '[이름_1]' → '[이름_2]' → 박샘플 로 두 번 바뀐다
    expect(restore('[이름_1] / [이름_2]', vault)).toBe(`[이름_2] / ${NAMES.park}`);
  });

  it('이미 가명인 자리는 다시 가명 처리하지 않는다', () => {
    const vault = createVault();
    const once = pseudonymize(`성명: ${NAMES.kim}`, vault);
    expect(pseudonymize(once, vault)).toBe(once);
  });

  it('JSON.stringify(vault) 와 Object.keys 에 원래 값이 없다', () => {
    const vault = createVault();
    pseudonymize(SENTENCES.join(' '), vault);
    const json = JSON.stringify(vault);
    expect(json).toBe(`{"redacted":true,"size":${vault.size}}`);
    for (const v of ORIGINALS) expect(json).not.toContain(v);
    expect(JSON.stringify({ log: vault, keys: Object.keys(vault) })).not.toContain(NAMES.lee);
  });

  it('라벨을 바꿀 수 있고, 대괄호·공백 라벨은 거절한다', () => {
    const vault = createVault({ labels: { name: 'NAME', phone: 'PHONE' } });
    expect(pseudonymize(`${NAMES.lee}님 ${SYN.phone1234}`, vault)).toBe('[NAME_1]님 [PHONE_1]');
    expect(() => createVault({ labels: { name: '이 름' } })).toThrow(KoPiiError);
    expect(() => createVault({ labels: { name: '[x]' } })).toThrow(KoPiiError);
  });

  it('tokens() 는 긴 가명부터, original() 은 모르는 가명에 undefined', () => {
    const vault = createVault();
    for (let k = 0; k < 11; k++) vault.tokenFor('phone', `010-0000-00${String(k).padStart(2, '0')}`);
    expect(vault.tokens()[0]).toBe('[전화_10]');
    expect(vault.original('[전화_99]')).toBeUndefined();
    expect(vault.original('[전화_1]')).toBe('010-0000-0000');
  });
});
