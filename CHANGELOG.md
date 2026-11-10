# Changelog

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
