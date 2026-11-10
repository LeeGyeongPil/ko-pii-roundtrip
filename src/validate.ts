// Input checks for the public entry points. Every failure is a KoPiiError (a TypeError subclass would
// be nicer, but KoPiiError is the one parent users catch) whose message says how to fix the call.

import { KoPiiError } from './errors';
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
