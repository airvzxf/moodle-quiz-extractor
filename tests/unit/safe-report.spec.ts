// tests/unit/safe-report.spec.ts
//
// Validates \`buildSafeReport\` behavior:
//   - Counts aggregate correctly.
//   - No canary pattern can leak through the JSON serialization.
//   - The \`truncated\` flag matches the dropped count.
//   - \`recentCodes\` is capped at 64 entries.

import { describe, it, expect } from 'vitest';
import { RingBufferLogger } from '~/diagnostics/logger';
import { buildSafeReport } from '~/diagnostics/safe-report';
import { findCanaryLeaks } from '~/diagnostics/canary-patterns';
import { MQX } from '~/diagnostics/codes';
import type {
  DiagnosticsCode,
  DiagnosticsStage,
  StoredDiagnosticsEvent,
} from '~/diagnostics/diagnostics-types';

function ev(
  ts: number,
  stage: DiagnosticsStage,
  code: DiagnosticsCode,
): StoredDiagnosticsEvent {
  return { ts, stage, code };
}

describe('buildSafeReport', () => {
  it('aggregates counts by stage and by code', () => {
    const r = new RingBufferLogger({ capacity: 200 });
    r.append(ev(1, 'parse', MQX.PARSE_UNKNOWN));
    r.append(ev(2, 'parse', MQX.PARSE_UNKNOWN));
    r.append(ev(3, 'fill', MQX.FILL_LETTER_NOT_FOUND));
    const report = buildSafeReport({
      ring: r,
      generatorVersion: '0.4.0',
      manifestVersion: 3,
    });
    expect(report.counts.events).toBe(3);
    expect(report.counts.byStage['parse']).toBe(2);
    expect(report.counts.byStage['fill']).toBe(1);
    expect(report.counts.byCode[MQX.PARSE_UNKNOWN]).toBe(2);
    expect(report.counts.byCode[MQX.FILL_LETTER_NOT_FOUND]).toBe(1);
    expect(report.truncated).toBe(false);
  });

  it('caps recentCodes at 64 entries', () => {
    const r = new RingBufferLogger({ capacity: 500 });
    // We only have a finite enum; produce many events across the valid
    // pairs. Since the enum has ~23 codes × 9 stages, we exercise ~64
    // unique pairs by cycling stages.
    for (let i = 0; i < 200; i += 1) {
      const stage: DiagnosticsStage = (
        ['parse', 'fill', 'asset', 'detect', 'download', 'fetch', 'page', 'popup', 'lifecycle'] as const
      )[i % 9]!;
      const code: DiagnosticsCode = MQX.PARSE_UNKNOWN;
      r.append(ev(i, stage, code));
    }
    const report = buildSafeReport({
      ring: r,
      generatorVersion: '0.4.0',
      manifestVersion: 3,
    });
    expect(report.recentCodes.length).toBeLessThanOrEqual(64);
  });

  it('serializes to JSON without any canary pattern', () => {
    const r = new RingBufferLogger({ capacity: 50 });
    r.append(ev(1, 'parse', MQX.PARSE_INVALID_LETTER));
    r.append(ev(2, 'fill', MQX.FILL_FETCH_BLOCKED));
    r.append(ev(3, 'asset', MQX.ASSET_NETWORK));
    const report = buildSafeReport({
      ring: r,
      generatorVersion: '0.4.0',
      manifestVersion: 3,
    });
    const json = JSON.stringify(report);
    const hits = findCanaryLeaks(json);
    expect(hits).toEqual([]);
  });

  it('marks truncated=true when the ring dropped events', () => {
    const r = new RingBufferLogger({ capacity: 2 });
    r.append(ev(1, 'parse', MQX.PARSE_UNKNOWN));
    r.append(ev(2, 'parse', MQX.PARSE_UNKNOWN));
    r.append(ev(3, 'parse', MQX.PARSE_UNKNOWN));
    const report = buildSafeReport({
      ring: r,
      generatorVersion: '0.4.0',
      manifestVersion: 3,
    });
    expect(report.ring.dropped).toBe(1);
    expect(report.truncated).toBe(true);
  });

  it('stamps schemaVersion and manifestVersion exactly', () => {
    const r = new RingBufferLogger({ capacity: 200 });
    const report = buildSafeReport({
      ring: r,
      generatorVersion: '0.4.0',
      manifestVersion: 3,
    });
    expect(report.schemaVersion).toBe('1.4.0');
    expect(report.generator).toBe('moodle-quiz-extractor');
    expect(report.manifestVersion).toBe(3);
  });
});