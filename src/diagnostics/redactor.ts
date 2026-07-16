// src/diagnostics/redactor.ts
//
// Runtime double-redaction (T15 §Seguridad: MQX-PRIV-401).
//
// The fixture redactor (`tools/redact-fixture.mjs`) replaces real session
// tokens, attempt ids, cmids, etc. with `__REDACTED__` BEFORE the HTML is
// committed. This module is the safety net that runs over every artifact
// produced by the extension (ZIP, manifest, clipboard, log) just before it
// leaves the browser.
//
// Design:
//  - `redactString(input)` runs all `CANARY_LABELS` over the input.
//  - On any hit, throws `MqxPrivLeakError` (code MQX-PRIV-401). This is the
//    "fail-closed" branch: a leak MUST be reviewed, never silently shipped.
//  - `redactStringSafe(input)` returns `{ ok: true, value }` or
//    `{ ok: false, leaks }` for callers that prefer to attach a warning
//    instead of throwing (e.g. the manifest builder).
//
// The redactor is intentionally a pure function — no DOM, no fetch, no
// state — so it can run identically in Node (tests) and in the background
// service worker (production).

import { MQX, type MqxCode } from '~/diagnostics/codes';
import { findCanaryLeaks, type CanaryHit } from '~/diagnostics/canary-patterns';

export class MqxPrivLeakError extends Error {
  readonly code: MqxCode = MQX.PRIV_LEAK_BLOCKED;
  readonly leaks: ReadonlyArray<CanaryHit>;

  constructor(leaks: ReadonlyArray<CanaryHit>) {
    super(
      `MQX-PRIV-401: redactor detected ${leaks.length} residual secret(s): ` +
        leaks.map((l) => l.label).join(', '),
    );
    this.name = 'MqxPrivLeakError';
    this.leaks = leaks;
  }
}

export type RedactResult =
  | { ok: true; value: string }
  | { ok: false; leaks: ReadonlyArray<CanaryHit> };

/** Throws `MqxPrivLeakError` if `input` contains any canary pattern. */
export function redactString(input: string): string {
  const leaks = findCanaryLeaks(input);
  if (leaks.length > 0) throw new MqxPrivLeakError(leaks);
  return input;
}

/** Non-throwing variant for callers that want to attach a warning instead. */
export function redactStringSafe(input: string): RedactResult {
  const leaks = findCanaryLeaks(input);
  if (leaks.length > 0) return { ok: false, leaks };
  return { ok: true, value: input };
}

/** Convenience: redact every value of a shallow object, throw on the first leak. */
export function redactObject<T extends Record<string, unknown>>(obj: T): T {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') {
      obj[k as keyof T] = redactString(v) as T[keyof T];
    }
  }
  return obj;
}