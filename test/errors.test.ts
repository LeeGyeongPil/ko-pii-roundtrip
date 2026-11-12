// Public entry points reject bad input with a KoPiiError that says how to fix the call (Q-1).

import { describe, expect, it } from 'vitest';
import { createStreamRestorer, createVault, detect, KoPiiError, pseudonymize, restore, UnknownOptionError } from '../src/index';
import { piiMiddleware } from '../src/ai-sdk';
import { wrapOpenAI } from '../src/openai';

// The tests deliberately pass wrong types, like a plain-JS user would.
const bad = (v: unknown): never => v as never;
const client = { chat: { completions: { create: () => ({}) } } };

describe('input validation', () => {
  it('piiMiddleware needs options with a vault', () => {
    expect(() => piiMiddleware(bad({}))).toThrow(KoPiiError);
    expect(() => piiMiddleware(bad({}))).toThrow(/createVault\(\)/);
    expect(() => piiMiddleware(bad(undefined))).toThrow(KoPiiError);
    expect(() => piiMiddleware(bad({ vault: {} }))).toThrow(KoPiiError);
    expect(() => piiMiddleware({ vault: createVault() })).not.toThrow();
  });

  it('wrapOpenAI needs options, a vault and a chat.completions.create client', () => {
    expect(() => wrapOpenAI(client, bad(undefined))).toThrow(/options object/);
    expect(() => wrapOpenAI(client, bad({}))).toThrow(/createVault\(\)/);
    expect(() => wrapOpenAI(bad({}), { vault: createVault() })).toThrow(/chat\.completions\.create/);
    expect(() => wrapOpenAI(bad(null), { vault: createVault() })).toThrow(KoPiiError);
    expect(() => wrapOpenAI(client, { vault: createVault() })).not.toThrow();
  });

  it('detect, pseudonymize and restore reject non-string text', () => {
    const vault = createVault();
    for (const v of [null, undefined, 42, {}]) {
      expect(() => detect(bad(v))).toThrow(/must be a string/);
      expect(() => pseudonymize(bad(v), vault)).toThrow(KoPiiError);
      expect(() => restore(bad(v), vault)).toThrow(KoPiiError);
    }
    expect(detect('')).toEqual([]);
    expect(restore('', vault)).toBe('');
  });

  it('pseudonymize, restore and createStreamRestorer reject a missing vault', () => {
    expect(() => pseudonymize('x', bad(undefined))).toThrow(/createVault\(\)/);
    expect(() => restore('x', bad(null))).toThrow(KoPiiError);
    expect(() => createStreamRestorer(bad(undefined))).toThrow(KoPiiError);
  });

  // Q-7: a look-alike object used to pass the duck-type check and put "undefined" into the text sent to the model
  it('rejects a vault look-alike that createVault() did not make', () => {
    const fake = bad({ tokenFor() {}, original() {}, tokens: () => [], size: 0, toJSON: () => ({}) });
    const message = /needs a vault made by createVault\(\), got an object it did not make/;
    expect(() => pseudonymize('고객 이예시님', fake)).toThrow(message);
    expect(() => restore('[이름_1]', fake)).toThrow(message);
    expect(() => createStreamRestorer(fake)).toThrow(message);
    expect(() => piiMiddleware({ vault: fake })).toThrow(message);
    expect(() => wrapOpenAI(client, { vault: fake })).toThrow(message);
    // a spread copy loses the hidden key too, so it is rejected instead of silently skipping known values
    expect(() => pseudonymize('x', bad({ ...createVault() }))).toThrow(KoPiiError);
  });

  // Q-7: the example in the message must match the call's real shape (piiMiddleware takes one argument)
  it('options errors show a correct example call for each entry point', () => {
    let err: unknown;
    try {
      piiMiddleware(bad(undefined));
    } catch (e) {
      err = e;
    }
    expect((err as Error).message).toBe(
      'piiMiddleware(options) needs an options object, got undefined. Example: piiMiddleware({ vault: createVault() }).',
    );
    expect(() => wrapOpenAI(client, bad(null))).toThrow(
      'wrapOpenAI(client, options) needs an options object, got null. Example: wrapOpenAI(new OpenAI(), { vault: createVault() }).',
    );
  });

  it('StreamRestorer.push rejects non-strings instead of printing "undefined"', () => {
    const r = createStreamRestorer(createVault());
    expect(() => r.push(bad(undefined))).toThrow(KoPiiError);
    expect(() => r.push(bad(null))).toThrow(/must be a string/);
    expect(r.push('')).toBe('');
    expect(r.push('안녕')).toBe('안녕');
  });
});

describe('unknown option keys', () => {
  const secret = '박샘플'; // synthetic name
  const v = () => createVault();

  it('pseudonymize and detect reject a misspelled key and suggest the right one', () => {
    expect(() => pseudonymize(`${secret} 방문`, v(), bad({ name: [secret] }))).toThrow(UnknownOptionError);
    expect(() => pseudonymize(`${secret} 방문`, v(), bad({ name: [secret] }))).toThrow(KoPiiError);
    expect(() => detect('x', bad({ nmaes: [secret] }))).toThrow(/unknown option 'nmaes'. Allowed: detectors, names.*Did you mean 'names'/);
    try {
      detect('x', bad({ nmaes: [secret] }));
    } catch (e) {
      expect(e).toBeInstanceOf(KoPiiError);
      expect((e as UnknownOptionError).option).toBe('nmaes');
      expect((e as UnknownOptionError).allowed).toEqual(['detectors', 'names']);
    }
  });

  it('adapters reject a top-level names at creation and point to detect', () => {
    expect(() => piiMiddleware(bad({ vault: v(), names: [secret] }))).toThrow(/detect: \{ names/);
    expect(() => wrapOpenAI(client, bad({ vault: v(), names: [secret] }))).toThrow(/detect: \{ names/);
    expect(() => wrapOpenAI(client, bad({ vault: v(), names: [secret] }))).toThrow(UnknownOptionError);
  });

  it('nested detect options are checked at creation', () => {
    expect(() => piiMiddleware(bad({ vault: v(), detect: { nmaes: [secret] } }))).toThrow(UnknownOptionError);
    expect(() => wrapOpenAI(client, bad({ vault: v(), detect: { nmaes: [secret] } }))).toThrow(/Did you mean 'names'/);
  });

  it('createVault rejects label and suggests labels', () => {
    expect(() => createVault(bad({ label: { name: 'X' } }))).toThrow(/Did you mean 'labels'/);
  });

  it('the message never contains option values', () => {
    for (const call of [
      () => pseudonymize('x', v(), bad({ name: [secret] })),
      () => piiMiddleware(bad({ vault: v(), names: [secret] })),
      () => wrapOpenAI(client, bad({ vault: v(), detect: { name: [secret] } })),
    ]) {
      expect(call).toThrow(UnknownOptionError);
      try {
        call();
      } catch (e) {
        expect((e as Error).message).not.toContain(secret);
      }
    }
  });

  it('calls using every allowed key still work', () => {
    expect(() => detect('x', { detectors: ['email'], names: [secret] })).not.toThrow();
    expect(() => pseudonymize('x', v(), { detectors: ['email'], names: [secret] })).not.toThrow();
    expect(() => createVault({ labels: { name: '사람' } })).not.toThrow();
    expect(() => piiMiddleware({ vault: v(), detect: { names: [secret] }, restoreReasoning: false, josa: false })).not.toThrow();
    expect(() => wrapOpenAI(client, { vault: v(), detect: { names: [secret] }, josa: false })).not.toThrow();
    expect(() => detect('x', undefined)).not.toThrow();
  });
});
