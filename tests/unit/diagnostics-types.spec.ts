// tests/unit/diagnostics-types.spec.ts
//
// Sanity checks for the closed Zod enumerations used by the two-tier
// diagnostics. We assert that the enums match the existing \`MQX\` map,
// that free-form strings are rejected, and that \`.strict()\` rejects
// unexpected keys on the input schema.

import { describe, it, expect } from 'vitest';
import {
  DiagnosticsCodeSchema,
  DiagnosticsEventInputSchema,
  DiagnosticsStageSchema,
  SafeReportSchema,
  isDiagnosticsCode,
} from '~/diagnostics/diagnostics-types';
import { MQX } from '~/diagnostics/codes';

describe('DiagnosticsStageSchema', () => {
  it('accepts every stage in the enum', () => {
    for (const stage of DiagnosticsStageSchema.options) {
      expect(DiagnosticsStageSchema.parse(stage)).toBe(stage);
    }
  });
  it('rejects unknown stages', () => {
    expect(() => DiagnosticsStageSchema.parse('whatever')).toThrow();
    expect(() => DiagnosticsStageSchema.parse('extract')).toThrow();
  });
});

describe('DiagnosticsCodeSchema', () => {
  it('accepts every MQX code currently enumerated', () => {
    const codes = Object.values(MQX);
    expect(codes.length).toBeGreaterThanOrEqual(20);
    for (const code of codes) {
      if (code === MQX.PRIV_LEAK_BLOCKED) {
        expect(() => DiagnosticsCodeSchema.parse(code)).toThrow();
      } else {
        expect(DiagnosticsCodeSchema.parse(code)).toBe(code);
      }
    }
  });
  it('rejects arbitrary strings, including canary-shaped ones', () => {
    expect(() => DiagnosticsCodeSchema.parse('sesskey=abc')).toThrow();
    expect(() => DiagnosticsCodeSchema.parse('hello world')).toThrow();
    expect(() => DiagnosticsCodeSchema.parse('')).toThrow();
  });
  it('isDiagnosticsCode returns true only for known codes', () => {
    expect(isDiagnosticsCode(MQX.FILL_LETTER_NOT_FOUND)).toBe(true);
    expect(isDiagnosticsCode(MQX.PRIV_LEAK_BLOCKED)).toBe(false);
    expect(isDiagnosticsCode('sesskey=abc')).toBe(false);
  });
});

describe('DiagnosticsEventInputSchema', () => {
  it('accepts a minimal valid event', () => {
    const ok = DiagnosticsEventInputSchema.parse({
      schemaVersion: '1.0',
      stage: 'parse',
      code: MQX.PARSE_INVALID_LETTER,
    });
    expect(ok.code).toBe(MQX.PARSE_INVALID_LETTER);
  });
  it('accepts a questionNumber', () => {
    const ok = DiagnosticsEventInputSchema.parse({
      schemaVersion: '1.0',
      stage: 'fill',
      code: MQX.FILL_LETTER_NOT_FOUND,
      questionNumber: 7,
    });
    expect(ok.questionNumber).toBe(7);
  });
  it('rejects extra fields (strict)', () => {
    expect(() =>
      DiagnosticsEventInputSchema.parse({
        schemaVersion: '1.0',
        stage: 'parse',
        code: MQX.PARSE_INVALID_LETTER,
        message: 'sesskey=leaked',
        ts: 1,
        tabId: 1,
      }),
    ).toThrow();
  });
  it('rejects unknown stages and codes', () => {
    expect(() =>
      DiagnosticsEventInputSchema.parse({
        schemaVersion: '1.0',
        stage: 'sneaky',
        code: MQX.PARSE_INVALID_LETTER,
      }),
    ).toThrow();
    expect(() =>
      DiagnosticsEventInputSchema.parse({
        schemaVersion: '1.0',
        stage: 'parse',
        code: 'sesskey=abc',
      }),
    ).toThrow();
  });
});

describe('SafeReportSchema', () => {
  it('roundtrips a minimal draft', () => {
    const draft = {
      schemaVersion: '1.4.0',
      generator: 'moodle-quiz-extractor',
      generatorVersion: '0.4.0',
      manifestVersion: 3,
      exportedAt: '2026-07-16T12:00:00.000Z',
      ring: { capacity: 200, length: 0, dropped: 0 },
      counts: {
        events: 0,
        byStage: {},
        byCode: {},
      },
      recentCodes: [],
      truncated: false,
    };
    const parsed = SafeReportSchema.safeParse(draft);
    expect(parsed.success).toBe(true);
  });
  it('rejects unknown fields in the outer shape', () => {
    const draft = {
      schemaVersion: '1.4.0',
      generator: 'moodle-quiz-extractor',
      generatorVersion: '0.4.0',
      manifestVersion: 3,
      exportedAt: '2026-07-16T12:00:00.000Z',
      ring: { capacity: 200, length: 0, dropped: 0 },
      counts: { events: 0, byStage: {}, byCode: {} },
      recentCodes: [],
      truncated: false,
      // Sneak in a sensitive field; should be rejected by .strict().
      tabId: 7,
      originHash: 'deadbeef',
    };
    expect(SafeReportSchema.safeParse(draft).success).toBe(false);
  });
});