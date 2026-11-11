# Changelog

## 0.1.3 (2026-11-11)

- Fix: `+82` international phone numbers are now pseudonymized instead of leaking to the model. Mobile and landline forms are covered, with the country code as part of the matched span: separators after `+82` may be `-`, `.`, a space or nothing, an optional `(0)` or `0` trunk digit is accepted, and the number part follows the same rules as the domestic forms. `+82 010-…` used to leave `+82 ` in the text and now matches as a whole. Other country codes, `+82,…` amounts and numbers with extra trailing digits are still not detected. Out of scope (documented in the README): `0082-…`/`82-…` without `+`, `(+82) …`, mixed separators after the area part (a `+82-10-0000-1234` with only some hyphens replaced by spaces), 15xx/16xx/18xx numbers.

## 0.1.2 (2026-11-11)

- Fix: names after `label명:` headings such as `고객명:` / `환자명:` (also with a full-width colon) are now pseudonymized instead of leaking to the model. A heading counts when it ends in `명`, the part before `명` is a known context word, and a colon follows. `고객명 홍길동` (no colon) is still not detected; use the `names` dictionary for that.

## 0.1.1 (2026-11-11)

- Fix: the consumer test harness now works with the npm 10 bundled in Node 22. `npm pack` runs the `prepare` build there, so the harness no longer fails to parse `test/consumers/run.mjs`. Test-only change; the library code is unchanged.

## 0.1.0 (2026-11-11)

- Core: `createVault`, `detect`, `pseudonymize`, `restore`, `createStreamRestorer`, `createJsonStringRestorer`, `restoreJsonText`, `hasBatchim`, `attachJosa`, `pickJosa`.
- Detectors (8): resident registration number, foreigner registration number, business registration number (checksum), mobile/landline phone, card (Luhn), bank account (bank-name context), email, name (surname + title/context + user dictionary).
- Josa correction after restore for 은/는, 이/가, 을/를, 과/와, 으로/로, 이랑/랑 (digits and Latin letters by their Korean reading).
- Streaming restore with a bounded holdback buffer; property-tested so any chunk split gives the same result as restoring the whole text.
- Adapters: `ko-pii-roundtrip/ai-sdk` (AI SDK 7 language model middleware, spec v4) and `ko-pii-roundtrip/openai` (`chat.completions.create`, stream and non-stream, tool call arguments).
- Dual ESM/CJS package with types for both; Node >= 22.12.
- Input validation: public entry points throw `KoPiiError` with a fix hint for missing vault/client or non-string text. Building from source needs Node >= 22.18.
- Vaults must come from `createVault()`; a look-alike object is rejected with `KoPiiError` instead of producing broken placeholders.
- Name detection: an attached honorific (님·씨) or a `label:` context wins over the common-word filter, so names that start with a common word (e.g. 박사+랑, 이상+인) are caught; bare titles (박사님·상무님) stay excluded.
