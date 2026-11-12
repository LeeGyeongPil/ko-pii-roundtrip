// Input checks for the public entry points. Every failure is a KoPiiError (a TypeError subclass would
// be nicer, but KoPiiError is the one parent users catch) whose message says how to fix the call.

import { KoPiiError, UnknownOptionError } from './errors';
import { DETECT_OPTION_KEYS } from './types';
import { vaultInternal } from './vault';

/** Short description of a bad value for error messages: null, undefined, number, object, ... */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** text must be a string. `where` names the call, e.g. "detect(text)". */
export function assertText(value: unknown, where: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new KoPiiError(`${where} must be a string, got ${describe(value)}. Convert it first, e.g. String(value) or value ?? ''.`);
  }
}

/**
 * vault must be made by createVault(). A look-alike object with tokenFor/original/tokens is not enough:
 * pseudonymize trusts tokenFor() to return a placeholder, so a stub could put "undefined" (or the
 * original value) into the text sent to the model. createVault() marks its vaults with an internal key.
 */
export function assertVault(value: unknown, where: string): void {
  const fix = 'Create one with createVault() and pass it in, e.g. { vault: createVault() }.';
  if (typeof value !== 'object' || value === null) {
    throw new KoPiiError(`${where} needs a vault, got ${describe(value)}. ${fix}`);
  }
  if (vaultInternal(value as never) === null) {
    throw new KoPiiError(`${where} needs a vault made by createVault(), got an object it did not make. ${fix}`);
  }
}

/**
 * opts must be an object (options bag). `example` is a correct call shown in the message,
 * e.g. "piiMiddleware({ vault: createVault() })".
 */
export function assertOptions(value: unknown, where: string, example: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new KoPiiError(`${where} needs an options object, got ${describe(value)}. Example: ${example}.`);
  }
}

/** Edit distance between two short strings (option names), for "Did you mean" suggestions. */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row.push(Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)));
    }
    prev = row;
  }
  return prev[b.length]!;
}

/** The allowed key closest to `key` (case-only difference or edit distance <= 2), if any. */
function closest(key: string, allowed: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = 3;
  for (const candidate of allowed) {
    const d = candidate.toLowerCase() === key.toLowerCase() ? 0 : distance(key, candidate);
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

/**
 * Reject option keys the function does not know instead of silently ignoring them (a typo such as
 * `name` for `names` would otherwise leak the original value). `value` may be undefined (no options).
 * Only key names go into the message, never values (they can be personal data). `hint` may return a
 * more specific fix for a key, e.g. a top-level `names` on an adapter; otherwise a close key is suggested.
 */
export function assertKnownKeys(
  value: unknown,
  allowed: readonly string[],
  where: string,
  hint?: (key: string) => string | undefined,
): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue;
    const near = closest(key, allowed);
    const fix = hint?.(key) ?? (near !== undefined ? `Did you mean '${near}'?` : '');
    const message = `${where} got an unknown option '${key}'. Allowed: ${allowed.join(', ')}.${fix === '' ? '' : ` ${fix}`}`;
    throw new UnknownOptionError(message, key, allowed);
  }
}

/** Check a DetectOptions bag (detect / pseudonymize and the adapters' `detect` option). */
export function assertDetectOptions(value: unknown, where: string): void {
  assertKnownKeys(value, DETECT_OPTION_KEYS, where);
}
