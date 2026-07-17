// tests/security/hardening-tiers.spec.ts
//
// Adversarial tests for the diagnostic two-tier system: hostile events,
// forced timestamps, hostile fixture HTML, canary persistence, and
// strict schema enforcement.

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { RingBufferLogger } from '~/diagnostics/logger';
import { buildSafeReport } from '~/diagnostics/safe-report';
import { buildFixtureBundle } from '~/diagnostics/fixture-builder';
import {
  DiagnosticsEventInputSchema,
  SafeReportSchema,
} from '~/diagnostics/diagnostics-types';
import { findCanaryLeaks } from '~/diagnostics/canary-patterns';
import { MQX } from '~/diagnostics/codes';
import { unzipSync, strFromU8 } from 'fflate';

const dom = new JSDOM('');
(globalThis as { DOMParser?: typeof DOMParser }).DOMParser = dom.window.DOMParser;
(globalThis as { XMLSerializer?: typeof XMLSerializer }).XMLSerializer =
  dom.window.XMLSerializer;

describe('hardening: hostile event injection', () => {
  it('rejects events with extra fields (strict)', () => {
    expect(() =>
      DiagnosticsEventInputSchema.parse({
        schemaVersion: '1.0',
        stage: 'parse',
        code: MQX.PARSE_UNKNOWN,
        ts: 1,
        tabId: 7,
        originHash: 'deadbeef',
        message: 'sesskey=leaked',
      }),
    ).toThrow();
  });

  it('rejects hostile canary-shaped strings in codes', () => {
    for (const evil of [
      'sesskey=leaked',
      'MoodleSession=abc',
      'attempt=99',
      'cmid=42',
      'foo@example.com',
    ]) {
      expect(() =>
        DiagnosticsEventInputSchema.parse({
          schemaVersion: '1.0',
          stage: 'parse',
          code: evil,
        }),
      ).toThrow();
    }
  });

  it('roundtrips 1000 events without losing integrity', () => {
    const ring = new RingBufferLogger({ capacity: 200 });
    for (let i = 0; i < 1000; i += 1) {
      ring.append({
        ts: i,
        stage: 'parse',
        code: MQX.PARSE_UNKNOWN,
      });
    }
    expect(ring.length()).toBe(200);
    expect(ring.dropped()).toBe(800);
    const report = buildSafeReport({
      ring,
      generatorVersion: '0.4.0',
      manifestVersion: 3,
    });
    expect(findCanaryLeaks(JSON.stringify(report))).toEqual([]);
    expect(SafeReportSchema.safeParse(report).success).toBe(true);
  });
});

describe('hardening: hostile fixture HTML', () => {
  it('strips every canary pattern from iframe srcdoc', () => {
    const out = buildFixtureBundle({
      rawHtml:
        '<html><body><iframe srcdoc="<script>sesskey=inside</script>"></iframe></body></html>',
      safeReportInput: {
        ring: RingBufferLogger.empty(),
        generatorVersion: '0.4.0',
        manifestVersion: 3,
      },
    });
    const files = unzipSync(out.bytes);
    const html = strFromU8(files['fixture.html']!);
    expect(findCanaryLeaks(html)).toEqual([]);
  });

  it('strips CSS url() payloads', () => {
    const out = buildFixtureBundle({
      rawHtml:
        '<html><head><style>body{background:url("sesskey=moreleak")}</style></head><body></body></html>',
      safeReportInput: {
        ring: RingBufferLogger.empty(),
        generatorVersion: '0.4.0',
        manifestVersion: 3,
      },
    });
    const files = unzipSync(out.bytes);
    const html = strFromU8(files['fixture.html']!);
    expect(findCanaryLeaks(html)).toEqual([]);
  });

  it('strips data-* attributes carrying canary markers', () => {
    const out = buildFixtureBundle({
      rawHtml:
        '<html><body><div data-attempt="42" data-q="ok" data-allowed="x">v</div></body></html>',
      safeReportInput: {
        ring: RingBufferLogger.empty(),
        generatorVersion: '0.4.0',
        manifestVersion: 3,
      },
    });
    const files = unzipSync(out.bytes);
    const html = strFromU8(files['fixture.html']!);
    expect(findCanaryLeaks(html)).toEqual([]);
    expect(html).not.toMatch(/data-attempt=/);
    expect(html).not.toMatch(/data-q=/);
    expect(html).toContain('data-allowed');
  });

  it('safe report JSON never leaks canary patterns', () => {
    const ring = new RingBufferLogger({ capacity: 50 });
    for (let i = 0; i < 50; i += 1) {
      ring.append({
        ts: i,
        stage: 'fill',
        code: MQX.FILL_LETTER_NOT_FOUND,
        questionNumber: i + 1,
      });
    }
    const out = buildFixtureBundle({
      rawHtml: '<html><body><p>x</p></body></html>',
      safeReportInput: {
        ring,
        generatorVersion: '0.4.0',
        manifestVersion: 3,
      },
    });
    const files = unzipSync(out.bytes);
    const safeReport = strFromU8(files['safe-report.json']!);
    expect(findCanaryLeaks(safeReport)).toEqual([]);
  });
});
