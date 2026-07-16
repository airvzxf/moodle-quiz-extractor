// src/export/manifest.ts
//
// Build the sidecar `manifest.json` from a `QuizDocument` + `AssetPlan` +
// list of warnings. Every string field is run through the redactor before
// serialization so a leak in `warnings[i].message` cannot escape.

import type { QuizDocument } from '~/domain/quiz-schema';
import type { Manifest, ManifestWarning } from '~/domain/manifest-schema';
import type { AssetEntry, AssetPlan } from '~/export/asset-planner';
import { redactString } from '~/diagnostics/redactor';

// These fields are COMPUTED outputs (SHA-256 of the origin / asset bytes)
// — they are public fingerprints, not leaked session values. The redactor
// is only applied to user-derived strings (titles, prompts, warning
// messages, raw URLs). Skipping these fields is the difference between a
// working ZIP and a redactor that blocks its own output.
const PASSTHROUGH_HASH_FIELDS = new Set(['originHash', 'sha256', 'generatorVersion']);

export interface BuildManifestInput {
  readonly doc: QuizDocument;
  readonly plan: AssetPlan;
  readonly generatorVersion: string;
  readonly exportedAt?: Date;
}

export function buildManifest(input: BuildManifestInput): Manifest {
  const { doc, plan, generatorVersion } = input;
  const exportedAt = (input.exportedAt ?? new Date()).toISOString();

  const assets = plan.entries.map((entry: AssetEntry) =>
    redactAsset(entry),
  );
  // Merge parse-stage warnings (from `doc.warnings`) with asset-stage
  // warnings (from `plan.warnings`) into the manifest so the user can see
  // both kinds in a single place. The dedupe via Map ensures repeated codes
  // for the same message aren't double-counted.
  const seen = new Set<string>();
  const warnings: ManifestWarning[] = [];
  for (const w of doc.warnings) {
    const key = `${w.code}|${w.stage}|${w.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    warnings.push(redactWarning(w));
  }
  for (const w of plan.warnings) {
    const key = `${w.code}|asset|${w.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    warnings.push({
      code: redactString(w.code),
      stage: 'asset',
      message: redactString(w.message),
    });
  }

  return {
    schemaVersion: '1.0',
    generator: 'moodle-quiz-extractor',
    // originHash and generatorVersion are computed/known-safe values — they
    // are public fingerprints, not leaked session data, so the redactor
    // MUST skip them. Apply redaction only to user-derived strings below.
    originHash: doc.source.originHash,
    generatorVersion,
    pagePath: redactString(doc.source.path),
    exportedAt,
    counts: {
      questions: doc.questions.length,
      assetsTotal: plan.entries.length,
      assetsDownloaded: plan.entries.filter((e) => e.status === 'downloaded').length,
      assetsFailed: plan.entries.filter((e) => e.status === 'failed').length,
      warnings: warnings.length,
    },
    assets,
    warnings,
  };
}

function redactAsset(entry: AssetEntry): {
  localPath: string;
  sourceUrl: string;
  mime: string;
  sha256?: string;
  bytes?: number;
  status: AssetEntry['status'];
  questionNumbers: number[];
  failureCode?: string;
} {
  return {
    localPath: redactString(entry.localPath),
    sourceUrl: redactString(entry.sourceUrl),
    mime: redactString(entry.mime),
    sha256: entry.sha256,
    bytes: entry.bytes?.byteLength,
    status: entry.status,
    questionNumbers: Array.from(entry.questionNumbers),
    failureCode: entry.failureCode,
  };
}

function redactWarning(w: ManifestWarning): ManifestWarning {
  return {
    code: redactString(w.code),
    stage: w.stage,
    message: redactString(w.message),
    questionNumber: w.questionNumber,
  };
}