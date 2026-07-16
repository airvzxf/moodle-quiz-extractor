// src/domain/manifest-schema.ts
//
// Sidecar manifest included in every ZIP alongside `quiz.md` and `quiz.json`.
// The manifest is the human-readable summary of the export: provenance,
// counts, asset list, warnings. It is intentionally separate from
// `quiz.json` so the JSON can stay machine-focused while the manifest can
// grow fields for diagnostics over time.
//
// Every string field is REDACTED before serialization by `buildManifest`.

import { z } from 'zod';

export const ManifestAssetSchema = z.object({
  localPath: z.string(),
  sourceUrl: z.string(), // canonical (no query, no fragment)
  mime: z.string(),
  sha256: z.string().length(64).optional(),
  bytes: z.number().int().nonnegative().optional(),
  status: z.enum(['downloaded', 'failed', 'skipped', 'pending']),
  questionNumbers: z.array(z.number().int().positive()),
  failureCode: z.string().optional(),
});
export type ManifestAsset = z.infer<typeof ManifestAssetSchema>;

export const ManifestWarningSchema = z.object({
  code: z.string(),
  stage: z.enum(['detect', 'fetch', 'parse', 'asset', 'render', 'fill', 'download']),
  message: z.string(),
  questionNumber: z.number().int().positive().optional(),
});
export type ManifestWarning = z.infer<typeof ManifestWarningSchema>;

export const ManifestSchema = z.object({
  schemaVersion: z.literal('1.0'),
  generator: z.literal('moodle-quiz-extractor'),
  generatorVersion: z.string(),
  originHash: z.string().length(64),
  pagePath: z.string(),
  exportedAt: z.string().datetime(),
  counts: z.object({
    questions: z.number().int().nonnegative(),
    assetsTotal: z.number().int().nonnegative(),
    assetsDownloaded: z.number().int().nonnegative(),
    assetsFailed: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
  }),
  assets: z.array(ManifestAssetSchema),
  warnings: z.array(ManifestWarningSchema),
});
export type Manifest = z.infer<typeof ManifestSchema>;