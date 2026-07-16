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