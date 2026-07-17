// src/diagnostics/fixture-redactor.ts
//
// Redacts residual canary patterns from already-sanitized HTML. Reuses
// the same patterns as \`tools/redact-fixture.mjs\` so a fixture built
// in the browser matches a fixture built offline. Fails closed: any
// canary hit raises \`FixtureRedactionError\`.

import { findCanaryLeaks, REDACTED_PLACEHOLDER } from '~/diagnostics/canary-patterns';

export class FixtureRedactionError extends Error {
  readonly label: string;
  constructor(label: string, message: string) {
    super(message);
    this.name = 'FixtureRedactionError';
    this.label = label;
  }
}

const REDACTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/sesskey=[A-Za-z0-9]+/g, `sesskey=${REDACTED_PLACEHOLDER}`],
  [/MoodleSession[\w-]*=[A-Za-z0-9]+/g, `MoodleSession=${REDACTED_PLACEHOLDER}`],
  [/\battempt=\d+/g, `attempt=${REDACTED_PLACEHOLDER}`],
  [/\bcmid=\d+/g, `cmid=${REDACTED_PLACEHOLDER}`],
  [/name="(q\d+:\d+_[A-Za-z0-9_:-]+)"/g, `name="${REDACTED_PLACEHOLDER}"`],
  [/\b[A-Fa-f0-9]{32,}\b/g, '__CHECKSUM_REDACTED__'],
  [
    /\b[A-Za-z][\w.+-]*@[A-Za-z0-9-]+\.[A-Za-z]{2,}\b/g,
    `email@${REDACTED_PLACEHOLDER}.invalid`,
  ],
];

export function redactFixtureHtml(html: string): { html: string; hits: number } {
  let out = html;
  let hits = 0;
  for (const [re, repl] of REDACTIONS) {
    re.lastIndex = 0;
    const matches = out.match(re);
    if (matches) hits += matches.length;
    re.lastIndex = 0;
    out = out.replace(re, repl);
  }
  // Fail-closed: the final result must NOT trip the canary gate.
  const leaks = findCanaryLeaks(out);
  if (leaks.length > 0) {
    throw new FixtureRedactionError(
      leaks[0]!.label,
      `fixture redaction left canary pattern: ${leaks[0]!.label}`,
    );
  }
  return { html: out, hits };
}
