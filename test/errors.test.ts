// Public entry points reject bad input with a KoPiiError that says how to fix the call (Q-1).

import { describe, expect, it } from 'vitest';
import { createStreamRestorer, createVault, detect, KoPiiError, pseudonymize, restore } from '../src/index';
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
