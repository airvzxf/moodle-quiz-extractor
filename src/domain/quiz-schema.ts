// src/domain/quiz-schema.ts
//
// Zod schemas + TS types for the canonical intermediate model.
// This is the "modelo intermedio" of T15's RF-3: the HTML never converts
// directly to Markdown; first it is normalized to a QuizDocument.

import { z } from 'zod';

export const QuestionKindSchema = z.enum([
  'single_choice',
  'multiple_choice',
  'short_text',
  'long_text',
  'select',
  'unsupported',
]);
export type QuestionKind = z.infer<typeof QuestionKindSchema>;

export const ChoiceSchema = z.object({
  letter: z.string().min(1).max(3), // a, b, c, d, e ... a, b, c, d, e ...
  label: z.string(),
  // sourceAnchor: stable selector back to the original DOM element (for
  // re-extraction, sanity checks, and post-mortem). NEVER the raw `name=`
  // attribute, which carries the attempt id.
  sourceAnchor: z.string().optional(),
});
export type Choice = z.infer<typeof ChoiceSchema>;

export const AssetReferenceSchema = z.object({
  // local file inside the export ZIP, e.g. "quiz/a2-examen-u1-a1b2c3d4.png"
  // Empty when the asset could not be downloaded (caller decides warn vs fail).
  localPath: z.string(),
  // original URL on the Moodle origin (without query string)
  sourceUrl: z.string(),
  mime: z.string().optional(),
  bytes: z.number().int().nonnegative().optional(),
  sha256: z.string().length(64).optional(),
  status: z.enum(['downloaded', 'failed', 'pending', 'skipped']),
});
export type AssetReference = z.infer<typeof AssetReferenceSchema>;

export const QuestionSchema = z.object({
  number: z.number().int().positive(),
  // SHA-256 hex of normalized content (prompt + choices). This is the public
  // identifier; the attempt id and slot are NEVER used as identifiers.
  stableFingerprint: z.string().length(64),
  kind: QuestionKindSchema,
  instruction: z.string().optional(),
  promptMarkdown: z.string(),
  choices: z.array(ChoiceSchema),
  metadata: z.object({
    gradeRaw: z.string().optional(),
    gradeValue: z.number().optional(),
    stateRaw: z.string().optional(),
  }),
  assets: z.array(AssetReferenceSchema),
  supportedForAutofill: z.boolean(),
  // Raw extraction warnings; never includes input names or session values.
  warnings: z.array(z.string()).default([]),
});
export type Question = z.infer<typeof QuestionSchema>;

export const ExportWarningSchema = z.object({
  code: z.string(), // e.g. "MQX-PARSE-101"
  stage: z.enum(['detect', 'fetch', 'parse', 'asset', 'render', 'fill', 'download']),
  message: z.string(),
  questionNumber: z.number().int().positive().optional(),
});
export type ExportWarning = z.infer<typeof ExportWarningSchema>;

export const SourceInfoSchema = z.object({
  // SHA-256 of the canonical (no query, no fragment) origin — never the URL
  // itself, since it carries the attempt id.
  originHash: z.string().length(64),
  // The path component, with query/fragment stripped of secrets.
  path: z.string(),
  pageCount: z.number().int().nonnegative(),
  exportedAt: z.string().datetime(),
});
export type SourceInfo = z.infer<typeof SourceInfoSchema>;

export const QuizDocumentSchema = z.object({
  schemaVersion: z.literal('1.0'),
  title: z.string(),
  course: z.string().optional(),
  unit: z.string().optional(),
  section: z.string().optional(),
  source: SourceInfoSchema,
  questions: z.array(QuestionSchema),
  warnings: z.array(ExportWarningSchema).default([]),
});
export type QuizDocument = z.infer<typeof QuizDocumentSchema>;

// Helper: build a fingerprint from a question's content (NOT its DOM id).
// SHA-256 hex. Uses Web Crypto when available (browser) and falls back to
// node:crypto for tests.
export async function fingerprint(
  parts: ReadonlyArray<string>,
): Promise<string> {
  const text = parts.join('\u0000');
  // Web Crypto (browser + Node 22+)
  if (typeof globalThis.crypto?.subtle?.digest === 'function') {
    const buf = new TextEncoder().encode(text);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback for very old test environments (shouldn't hit in CI).
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(text).digest('hex');
}
