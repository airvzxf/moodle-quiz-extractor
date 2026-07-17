// src/diagnostics/safe-report.ts
//
// \`buildSafeReport\` projects a \`RingBufferLogger\` snapshot into the
// minimal, privacy-preserving \`SafeReport\` shape. It is the ONLY way
// the contents of the diagnostic ring leave the background SW.
//
// Guarantees:
//   - No timestamp, no tabId, no originHash, no title, no URL.
//   - Counts are aggregated, not enumerated (no per-event timestamps).
//   - The ring is bounded; we report \`truncated\` if it dropped events.
//   - The output passes through \`SafeReportSchema.safeParse\`; any
//     unexpected field is rejected by \`.strict()\`.
//
// Tests in \`tests/unit/safe-report.spec.ts\` assert:
//   - Missing fields → throws.
//   - Roundtrip through JSON produces no canary hits.
//   - Top \`recentCodes\` are ordered by count desc.

import {
  SAFE_REPORT_SCHEMA_VERSION,
  type DiagnosticsCode,
  type DiagnosticsStage,
  type SafeReport,
  type StoredDiagnosticsEvent,
} from '~/diagnostics/diagnostics-types';
import { SafeReportSchema } from '~/diagnostics/diagnostics-types';
import { RingBufferLogger } from '~/diagnostics/logger';

export interface BuildSafeReportInput {
  readonly ring: RingBufferLogger;
  readonly generatorVersion: string;
  readonly manifestVersion: 3;
  readonly now?: () => number;
}

const MAX_RECENT_CODES = 64;

export function buildSafeReport(input: BuildSafeReportInput): SafeReport {
  const { ring, generatorVersion, manifestVersion, now = Date.now } = input;
  const events: ReadonlyArray<StoredDiagnosticsEvent> = ring.snapshot();
  const byStage: Record<string, number> = {};
  const byCode: Record<string, number> = {};
  const pairCounts = new Map<
    string,
    { code: DiagnosticsCode; stage: DiagnosticsStage; count: number }
  >();

  for (const ev of events) {
    byStage[ev.stage] = (byStage[ev.stage] ?? 0) + 1;
    byCode[ev.code] = (byCode[ev.code] ?? 0) + 1;
    const key = `${ev.code} ${ev.stage}`;
    const existing = pairCounts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      pairCounts.set(key, {
        code: ev.code,
        stage: ev.stage,
        count: 1,
      });
    }
  }

  const recentCodes = [...pairCounts.values()]
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
    .slice(0, MAX_RECENT_CODES);

  const draft: SafeReport = {
    schemaVersion: SAFE_REPORT_SCHEMA_VERSION,
    generator: 'moodle-quiz-extractor',
    generatorVersion,
    manifestVersion,
    exportedAt: new Date(now()).toISOString(),
    ring: {
      capacity: ring.capacity_size(),
      length: ring.length(),
      dropped: ring.dropped(),
    },
    counts: {
      events: events.length,
      byStage,
      byCode,
    },
    recentCodes,
    truncated: ring.dropped() > 0,
  };

  const parsed = SafeReportSchema.safeParse(draft);
  if (!parsed.success) {
    throw new Error(
      `safe report failed schema validation: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}