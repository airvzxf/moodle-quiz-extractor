// src/diagnostics/diagnostics-types.ts
//
// Closed enumerations + Zod schemas for the two-tier diagnostic system
// (Fase 4.1). Every event accepted by the background is validated against
// these schemas; no free-form strings, no PII fields, no timestamps from
// the caller. The background stamps `ts` and derives `tabId` from
// `sender.tab`.
//
// Why a closed enum and not a free string: the safe report exports codes
// verbatim. Allowing a content script to send `code: "sesskey=..."` would
// defeat the entire "code-only" invariant — Zod `z.string()` validates
// the shape but not the contents.

import { z } from 'zod';
import { MQX, type MqxCode } from '~/diagnostics/codes';

/** Diagnostic stage. Mirrors the stage enum already used by
 *  \`ExportWarningSchema.stage\` (\`src/domain/quiz-schema.ts\`) plus
 *  \`popup\` and \`lifecycle\` for Fase 4 events emitted by the new code
 *  paths. The background rejects any unknown stage. */
export const DiagnosticsStageSchema = z.enum([
  'detect',
  'parse',
  'fetch',
  'page',
  'asset',
  'fill',
  'download',
  'popup',
  'lifecycle',
]);
export type DiagnosticsStage = z.infer<typeof DiagnosticsStageSchema>;

/** Subset of \`MQX\` codes that the runtime diagnostics system may emit.
 *  We deliberately do NOT include \`MQX.PRIV_LEAK_BLOCKED\` here — a
 *  privacy leak aborts the operation, it does not become a "counted"
 *  diagnostic event. */
export const DiagnosticsCodeSchema = z.enum([
  MQX.DETECT_NO_FORM,
  MQX.DETECT_LOGIN,
  MQX.DETECT_NOT_QUIZ,
  MQX.DETECT_SUMMARY,
  MQX.DETECT_UNSUPPORTED_LAYOUT,
  MQX.PARSE_UNKNOWN,
  MQX.PARSE_NOT_IMPLEMENTED,
  MQX.PARSE_INVALID_LETTER,
  MQX.PARSE_NO_VISIBLE_CONTROL,
  MQX.ASSET_MIME_DENIED,
  MQX.ASSET_TOO_LARGE,
  MQX.ASSET_NETWORK,
  MQX.ASSET_REDIRECT_LOGIN,
  MQX.FILL_LETTER_NOT_FOUND,
  MQX.FILL_CONTROL_NOT_CONFIRMED,
  MQX.FILL_HIDDEN_TOUCHED,
  MQX.FILL_SUBMIT_BLOCKED,
  MQX.FILL_FETCH_BLOCKED,
  MQX.FILL_JOB_EXPIRED,
  MQX.FILL_FINGERPRINT_MISMATCH,
  MQX.FILL_UNSUPPORTED_STRICT,
  MQX.FILL_CONTROL_NOT_CONFIRMED_POST,
  MQX.PAGE_LAYOUT_UNRECOGNIZED,
  MQX.PAGE_NAVIGATION_SKIPPED,
]);
export type DiagnosticsCode = z.infer<typeof DiagnosticsCodeSchema>;

export const DiagnosticsEventInputSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    stage: DiagnosticsStageSchema,
    code: DiagnosticsCodeSchema,
    questionNumber: z.number().int().positive().optional(),
  })
  .strict();
export type DiagnosticsEventInput = z.infer<typeof DiagnosticsEventInputSchema>;

/** Stored event after the background stamps metadata. NEVER sent to the
 *  content script or popup; only used for the safe-report aggregation. */
export const StoredDiagnosticsEventSchema = z.object({
  ts: z.number().int().nonnegative(),
  stage: DiagnosticsStageSchema,
  code: DiagnosticsCodeSchema,
  questionNumber: z.number().int().positive().optional(),
});
export type StoredDiagnosticsEvent = z.infer<typeof StoredDiagnosticsEventSchema>;

export const SafeReportSchema = z
  .object({
    schemaVersion: z.literal('1.4.0'),
    generator: z.literal('moodle-quiz-extractor'),
    generatorVersion: z.string().min(1),
    manifestVersion: z.literal(3),
    exportedAt: z.string().datetime(),
    ring: z.object({
      capacity: z.number().int().positive(),
      length: z.number().int().nonnegative(),
      dropped: z.number().int().nonnegative(),
    }),
    counts: z.object({
      events: z.number().int().nonnegative(),
      byStage: z.record(z.string(), z.number().int().nonnegative()),
      byCode: z.record(z.string(), z.number().int().nonnegative()),
    }),
    recentCodes: z
      .array(
        z.object({
          code: DiagnosticsCodeSchema,
          stage: DiagnosticsStageSchema,
          count: z.number().int().positive(),
        }),
      )
      .max(64),
    truncated: z.boolean(),
  })
  .strict();
export type SafeReport = z.infer<typeof SafeReportSchema>;

export const SAFE_REPORT_SCHEMA_VERSION = '1.4.0' as const;
export const DIAGNOSTICS_EVENT_SCHEMA_VERSION = '1.0' as const;

export const DIAGNOSTICS_RING_CAPACITY = 200;
export const DIAGNOSTICS_TTL_MS = 30 * 60 * 1000;

/** Helper used by other modules to assert a value is a known code. */
export function isDiagnosticsCode(value: string): value is MqxCode {
  return (
    (DiagnosticsCodeSchema.options as readonly string[]).includes(value)
  );
}