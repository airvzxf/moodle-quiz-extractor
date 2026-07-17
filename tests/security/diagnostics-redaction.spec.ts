// tests/security/diagnostics-redaction.spec.ts
//
// Security gating: the safe report must NEVER serialize a canary
// pattern, even if the ring was populated with hostile events. The
// runtime schema (Zod .strict) already rejects free-form strings; this
// test confirms the aggregated projection still cannot leak secrets.

import { describe, it, expect } from 'vitest';
import { RingBufferLogger } from '~/diagnostics/logger';
import { buildSafeReport } from '~/diagnostics/safe-report';
import { findCanaryLeaks, type CanaryHit } from '~/diagnostics/canary-patterns';
import {
  DiagnosticsCodeSchema,
  type DiagnosticsEventInput,
} from '~/diagnostics/diagnostics-types';
import { MQX } from '~/diagnostics/codes';

const CANARIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\battempt=\d+/, 'attempt=NNN'],
  [/\bcmid=\d+/, 'cmid=NNN'],
  [/sesskey=[A-Za-z0-9]+(?![_])/, 'sesskey=<alnum-only>'],
  [/MoodleSession[\w-]*=[A-Za-z0-9]+(?![_])/, 'MoodleSession=<alnum-only>'],
  [/name="q\d+:\d+_/, 'name="qNNN:NNN_<something>'],
  [/\b[A-Fa-f0-9]{32,}\b/, 'long-hex-blob'],
  [/\b[A-Za-z][\w.+-]*@[A-Za-z0-9-]+\.[A-Za-z]{2,}/, 'email'],
];

describe('safe report redaction', () => {
  it('cannot leak canary tokens through codes or aggregation', () => {
    const ring = new RingBufferLogger({ capacity: 50 });
    // 100 hostile events that try every code, none of which is a
    // canary string (the schema forbids free-form strings), so the
    // aggregation stays clean.
    const codes = DiagnosticsCodeSchema.options;
    for (let i = 0; i < 100; i += 1) {
      const input: DiagnosticsEventInput = {
        schemaVersion: '1.0',
        stage: ['parse', 'fill', 'asset'][i % 3] as DiagnosticsEventInput['stage'],
        code: codes[i % codes.length]!,
      };
      ring.appendInput(input, i);
    }
    const report = buildSafeReport({
      ring,
      generatorVersion: '0.4.0',
      manifestVersion: 3,
    });
    const json = JSON.stringify(report);
    for (const [re] of CANARIES) {
      re.lastIndex = 0;
      expect(re.test(json)).toBe(false);
    }
  });

  it('JSON serialization has zero canary hits', () => {
    const ring = new RingBufferLogger({ capacity: 50 });
    ring.appendInput(
      { schemaVersion: '1.0', stage: 'parse', code: MQX.PARSE_UNKNOWN },
      1,
    );
    ring.appendInput(
      { schemaVersion: '1.0', stage: 'fill', code: MQX.FILL_LETTER_NOT_FOUND, questionNumber: 2 },
      2,
    );
    const report = buildSafeReport({
      ring,
      generatorVersion: '0.4.0',
      manifestVersion: 3,
    });
    const json = JSON.stringify(report);
    const hits: CanaryHit[] = findCanaryLeaks(json);
    expect(hits).toEqual([]);
  });
});