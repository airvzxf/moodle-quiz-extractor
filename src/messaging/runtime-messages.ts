// src/messaging/runtime-messages.ts
//
// Tiny typed contract between the content script, the popup, and the
// background service worker. Zod schemas validate at the boundary so a
// malformed payload from one context can't crash another.

import { z } from 'zod';

export const QuizExtractRequestSchema = z.object({
  kind: z.literal('extractQuiz'),
});
export type QuizExtractRequest = z.infer<typeof QuizExtractRequestSchema>;

export const QuizDocumentMessageSchema = z.object({
  kind: z.literal('quizDocument'),
  document: z.unknown(), // validated downstream by QuizDocumentSchema
});
export type QuizDocumentMessage = z.infer<typeof QuizDocumentMessageSchema>;

export const ZipRequestSchema = z.object({
  kind: z.literal('zipQuiz'),
  document: z.unknown(),
  /**
   * Live URL of the tab that originated the request (content script reads
   * `window.location.href` and forwards it). The background uses this to
   * request a host permission scoped to the real Moodle origin instead of
   * falling back to `<all_urls>`. Optional for backward compatibility with
   * older content scripts that don't yet forward it; missing values fall
   * back to the previous behavior with a warning.
   */
  tabUrl: z.string().optional(),
});
export type ZipRequest = z.infer<typeof ZipRequestSchema>;

export const ZipResultSchema = z.object({
  kind: z.literal('zipResult'),
  ok: z.boolean(),
  filename: z.string().optional(),
  counts: z
    .object({
      assetsTotal: z.number().int().nonnegative(),
      assetsDownloaded: z.number().int().nonnegative(),
      assetsFailed: z.number().int().nonnegative(),
    })
    .optional(),
  warnings: z.array(z.string()).optional(),
  error: z.string().optional(),
});
export type ZipResult = z.infer<typeof ZipResultSchema>;

// ---------------------------------------------------------------------------
// Fase 3 — autofill runtime messages. All new schemas are retro-compatible:
// the receivers use `safeParse`, so an older popup that doesn't know about
// `prepareAutofill` continues to work with `extractQuiz` / `zipQuiz`.
// ---------------------------------------------------------------------------

export const PrepareAutofillRequestSchema = z.object({
  kind: z.literal('prepareAutofill'),
  jobId: z.string().uuid(),
  answersText: z.string(),
});
export type PrepareAutofillRequest = z.infer<typeof PrepareAutofillRequestSchema>;

export const PrepareAutofillResultSchema = z.object({
  kind: z.literal('prepareAutofillResult'),
  jobId: z.string().uuid(),
  ok: z.boolean(),
  errors: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
  stepCount: z.number().int().nonnegative().optional(),
});
export type PrepareAutofillResult = z.infer<typeof PrepareAutofillResultSchema>;

export const ApplyAutofillRequestSchema = z.object({
  kind: z.literal('applyAutofill'),
  jobId: z.string().uuid(),
});
export type ApplyAutofillRequest = z.infer<typeof ApplyAutofillRequestSchema>;

export const ApplyAutofillResultSchema = z.object({
  kind: z.literal('applyAutofillResult'),
  jobId: z.string().uuid(),
  ok: z.boolean(),
  applied: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  errors: z.array(z.string()).optional(),
});
export type ApplyAutofillResult = z.infer<typeof ApplyAutofillResultSchema>;

export const AbortAutofillRequestSchema = z.object({
  kind: z.literal('abortAutofill'),
  jobId: z.string().uuid(),
});
export type AbortAutofillRequest = z.infer<typeof AbortAutofillRequestSchema>;

export const GetAutofillJobRequestSchema = z.object({
  kind: z.literal('getAutofillJob'),
  jobId: z.string().uuid(),
});
export type GetAutofillJobRequest = z.infer<typeof GetAutofillJobRequestSchema>;

export const GetAutofillJobResultSchema = z.object({
  kind: z.literal('getAutofillJobResult'),
  jobId: z.string().uuid(),
  found: z.boolean(),
  state: z.string().optional(),
});
export type GetAutofillJobResult = z.infer<typeof GetAutofillJobResultSchema>;

// ---------------------------------------------------------------------------
// Popup session persistence. The popup persists its work-in-progress state
// (extracted QuizDocument, answers textarea, autofill jobId) in
// `storage.session` so that switching windows does not lose progress.
// ---------------------------------------------------------------------------

export const LoadPopupSessionRequestSchema = z.object({
  kind: z.literal('loadPopupSession'),
  tabId: z.number().int().nonnegative(),
  originHash: z.string().length(64),
});
export type LoadPopupSessionRequest = z.infer<typeof LoadPopupSessionRequestSchema>;

export const LoadPopupSessionResultSchema = z.object({
  kind: z.literal('loadPopupSessionResult'),
  found: z.boolean(),
  /**
   * The serialized PopupSessionState. Validated downstream by the popup
   * (we cannot trust the background's stored shape across versions).
   */
  state: z.unknown().optional(),
  reason: z.enum(['missing', 'expired', 'stale-tab', 'malformed']).optional(),
});
export type LoadPopupSessionResult = z.infer<typeof LoadPopupSessionResultSchema>;

export const SavePopupSessionRequestSchema = z.object({
  kind: z.literal('savePopupSession'),
  tabId: z.number().int().nonnegative(),
  originHash: z.string().length(64),
  /**
   * Full PopupSessionState. The background applies its own
   * `redactString` before writing to storage; the popup also redacts
   * the in-memory form. Belt and suspenders.
   */
  state: z.object({
    answersText: z.string(),
    lastDocumentJson: z.string(),
    lastJobId: z.string().nullable(),
    hasAutofillContext: z.boolean(),
  }),
});
export type SavePopupSessionRequest = z.infer<typeof SavePopupSessionRequestSchema>;

export const SavePopupSessionResultSchema = z.object({
  kind: z.literal('savePopupSessionResult'),
  ok: z.boolean(),
  savedAt: z.number().int().nonnegative().optional(),
});
export type SavePopupSessionResult = z.infer<typeof SavePopupSessionResultSchema>;

export const ClearPopupSessionRequestSchema = z.object({
  kind: z.literal('clearPopupSession'),
  tabId: z.number().int().nonnegative(),
  originHash: z.string().length(64),
});
export type ClearPopupSessionRequest = z.infer<typeof ClearPopupSessionRequestSchema>;

export const ClearPopupSessionResultSchema = z.object({
  kind: z.literal('clearPopupSessionResult'),
  ok: z.boolean(),
});
export type ClearPopupSessionResult = z.infer<typeof ClearPopupSessionResultSchema>;

// ---------------------------------------------------------------------------
// Fase 4.1 — diagnostic two-tier. The content script pushes a closed
// schema (no strings free, no timestamp, no tabId). The background
// stamps `ts` and derives `tabId` from `sender.tab`. The popup asks for
// the safe report and the background responds with a redacted snapshot.
// ---------------------------------------------------------------------------

import {
  DiagnosticsEventInputSchema,
  SafeReportSchema,
} from '~/diagnostics/diagnostics-types';

export const LogDiagnosticsEventRequestSchema = z.object({
  kind: z.literal('logDiagnosticsEvent'),
  tabId: z.number().int().nonnegative(),
  input: DiagnosticsEventInputSchema,
});
export type LogDiagnosticsEventRequest = z.infer<typeof LogDiagnosticsEventRequestSchema>;

export const LogDiagnosticsEventResultSchema = z.object({
  kind: z.literal('logDiagnosticsEventResult'),
  ok: z.boolean(),
  error: z.string().optional(),
});
export type LogDiagnosticsEventResult = z.infer<typeof LogDiagnosticsEventResultSchema>;

export const CollectDiagnosticsRequestSchema = z.object({
  kind: z.literal('collectDiagnostics'),
  tabId: z.number().int().nonnegative(),
});
export type CollectDiagnosticsRequest = z.infer<typeof CollectDiagnosticsRequestSchema>;

export const SafeReportResultSchema = z.object({
  kind: z.literal('safeReportResult'),
  ok: z.boolean(),
  report: SafeReportSchema.optional(),
  error: z.string().optional(),
});
export type SafeReportResult = z.infer<typeof SafeReportResultSchema>;

export const PreviewFixtureRequestSchema = z.object({
  kind: z.literal('previewFixture'),
  tabId: z.number().int().nonnegative(),
});
export type PreviewFixtureRequest = z.infer<typeof PreviewFixtureRequestSchema>;

export const PreviewFixtureResultSchema = z.object({
  kind: z.literal('previewFixtureResult'),
  ok: z.boolean(),
  preview: z
    .object({
      bytes: z.number().int().nonnegative(),
      canaryHits: z.array(z.string()),
      entryCount: z.number().int().nonnegative(),
    })
    .optional(),
  error: z.string().optional(),
});
export type PreviewFixtureResult = z.infer<typeof PreviewFixtureResultSchema>;

export const DownloadFixtureRequestSchema = z.object({
  kind: z.literal('downloadFixture'),
  tabId: z.number().int().nonnegative(),
  ackCanaryHits: z.array(z.string()),
});
export type DownloadFixtureRequest = z.infer<typeof DownloadFixtureRequestSchema>;

export const DownloadFixtureResultSchema = z.object({
  kind: z.literal('downloadFixtureResult'),
  ok: z.boolean(),
  filename: z.string().optional(),
  bytes: z.number().int().nonnegative().optional(),
  refusedReason: z.enum(['canary-detected', 'permission-denied', 'unavailable']).optional(),
  error: z.string().optional(),
});
export type DownloadFixtureResult = z.infer<typeof DownloadFixtureResultSchema>;