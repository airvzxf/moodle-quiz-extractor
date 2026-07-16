// src/diagnostics/canary-patterns.ts
//
// Shared canary patterns and the placeholder convention used by both the
// fixture redactor (`tools/redact-fixture.mjs`) and the runtime redactor
// (`src/diagnostics/redactor.ts`). A canary pattern matches a REAL secret
// that should never survive redaction; the placeholder string (`__REDACTED__`)
// is intentionally constructed so it cannot accidentally satisfy any
// canary pattern.
//
// Why the underscores matter: the `sesskey=[A-Za-z0-9]+` regex would match
// `sesskey=REDACTED` because REDACTED is alnum-only. The placeholder
// `__REDACTED__` contains underscores, which the same regex excludes via
// `(?![_])` and the `\b…\b` boundaries, so a canary match is unambiguous.

/** Placeholder string used for every redacted value. Underscored so canary
 *  regexes (e.g. `[A-Za-z0-9]+(?![_])`) cannot accidentally match it. */
export const REDACTED_PLACEHOLDER = '__REDACTED__';

/** Human-friendly canary labels for diagnostics output. */
export interface CanaryHit {
  readonly label: string;
  readonly match: string;
}

export const CANARY_LABELS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\battempt=\d+/, 'attempt=NNN'],
  [/\bcmid=\d+/, 'cmid=NNN'],
  [/sesskey=[A-Za-z0-9]+(?![_])/, 'sesskey=<alnum-only>'],
  [/MoodleSession[\w-]*=[A-Za-z0-9]+(?![_])/, 'MoodleSession=<alnum-only>'],
  [/name="q\d+:\d+_/, 'name="qNNN:NNN_<something>'],
  [/\b[A-Fa-f0-9]{32,}\b/, 'long-hex-blob'],
  [/\b[A-Za-z][\w.+-]*@[A-Za-z0-9-]+\.[A-Za-z]{2,}/, 'email'],
];

/** Returns every canary pattern that matches `input`. The order matches
 *  `CANARY_LABELS`. Each hit includes the literal substring that matched,
 *  so callers can log exactly which token survived. */
export function findCanaryLeaks(input: string): CanaryHit[] {
  const hits: CanaryHit[] = [];
  for (const [re, label] of CANARY_LABELS) {
    // Reset stateful regex between calls.
    re.lastIndex = 0;
    const m = re.exec(input);
    if (m) hits.push({ label, match: m[0] });
  }
  return hits;
}