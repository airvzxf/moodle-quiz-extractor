// src/background/zip-orchestrator.ts
//
// Glue between the pure modules (`AssetPlanner`, `ManifestBuilder`,
// `ZipPackager`) and the browser-bound modules (`AssetFetcher`,
// `DownloadService`). Owns the end-to-end pipeline:
//
//   QuizDocument
//     → AssetPlanner    (dedupe, MIME, naming)
//     → AssetFetcher    (parallel GET, magic bytes, MIME allowlist)
//     → ManifestBuilder (counts, provenance, asset list)
//     → ZipPackager     (quiz.md + quiz.json + manifest.json + quiz/*)
//     → DownloadService (downloads.download + revoke blob URL)
//
// Every step is replaceable so tests can stub the fetcher and downloader.
// All string fields are run through the redactor twice: once at planner
// output (URL canonicalisation strips the query) and once at ZIP time
// (defense in depth).

import type { QuizDocument } from '~/domain/quiz-schema';
import {
  buildAssetPlan,
  type AssetEntry,
  type AssetPlan,
} from '~/export/asset-planner';
import { buildManifest } from '~/export/manifest';
import { buildZip } from '~/export/zip';
import { redactString } from '~/diagnostics/redactor';
import { MQX, type MqxCode } from '~/diagnostics/codes';
import type { AssetFetcher, FetchedAsset } from './asset-fetch-client';
import type { DownloadService } from './download-service';

export interface OrchestratorInput {
  readonly doc: QuizDocument;
  readonly fetcher: AssetFetcher;
  readonly downloader: DownloadService;
  readonly generatorVersion: string;
  readonly archiveBaseName?: string;
  readonly now?: Date;
}

export interface OrchestratorResult {
  readonly plan: AssetPlan;
  readonly fetched: ReadonlyArray<FetchedAsset>;
  readonly zip: Uint8Array;
  readonly download: { id: number | null; filename: string; blobUrl: string };
  readonly counts: {
    readonly assetsTotal: number;
    readonly assetsDownloaded: number;
    readonly assetsFailed: number;
  };
  readonly warnings: ReadonlyArray<{ code: MqxCode; message: string }>;
}

export async function runZipPipeline(
  input: OrchestratorInput,
): Promise<OrchestratorResult> {
  const { doc, fetcher, downloader, generatorVersion } = input;
  const now = input.now ?? new Date();

  const assetInputs = collectAssetInputs(doc);
  const basePlan = buildAssetPlan(assetInputs);
  const fetched = await fetcher.fetchAll(basePlan.entries);
  const updatedEntries = applyFetchedResults(basePlan.entries, fetched);

  const plan: AssetPlan = {
    entries: updatedEntries,
    warnings: [
      ...basePlan.warnings,
      ...fetched
        .filter((f) => f.status === 'failed')
        .map((f) => ({
          code: f.failureCode ?? MQX.ASSET_NETWORK,
          message: f.errorMessage ?? `failed to fetch ${f.entry.sourceUrl}`,
        })),
    ],
  };

  const manifest = buildManifest({
    doc,
    plan,
    generatorVersion,
    exportedAt: now,
  });

  const markdown = renderQuiz(propagateLocalPaths(doc, plan), {
  exportedAt: now,
  generatorVersion: input.generatorVersion,
});
  const json = JSON.stringify(propagateLocalPaths(doc, plan), null, 2);

  const assets = new Map<string, Uint8Array>();
  for (const f of fetched) {
    if (f.status === 'downloaded' && f.bytes) {
      assets.set(f.entry.localPath, f.bytes);
    }
  }

  const zip = buildZip({
    markdown,
    json,
    manifest: JSON.stringify(manifest, null, 2),
    assets,
    archiveLabel: redactString(input.archiveBaseName ?? 'export'),
  });

  const baseName = sanitizeFilename(
    input.archiveBaseName ?? `quiz-${doc.source.originHash.slice(0, 8)}`,
  );
  const filename = `${baseName}.zip`;
  const download = await downloader.downloadZip(zip, filename);

  return {
    plan,
    fetched,
    zip,
    download,
    counts: {
      assetsTotal: plan.entries.length,
      assetsDownloaded: plan.entries.filter((e) => e.status === 'downloaded').length,
      assetsFailed: plan.entries.filter((e) => e.status === 'failed').length,
    },
    warnings: plan.warnings,
  };
}

function collectAssetInputs(doc: QuizDocument) {
  const out: Array<{ sourceUrl: string; mime?: string; questionNumbers: number[] }> = [];
  for (const q of doc.questions) {
    for (const a of q.assets) {
      if (!a.sourceUrl) continue;
      out.push({
        sourceUrl: a.sourceUrl,
        mime: a.mime,
        questionNumbers: [q.number],
      });
    }
  }
  return out;
}

function applyFetchedResults(
  entries: ReadonlyArray<AssetEntry>,
  fetched: ReadonlyArray<FetchedAsset>,
): AssetEntry[] {
  const byUrl = new Map<string, FetchedAsset>();
  for (const f of fetched) byUrl.set(f.entry.sourceUrl, f);
  return entries.map((entry) => {
    const f = byUrl.get(entry.sourceUrl);
    if (!f) return entry;
    if (f.status === 'downloaded' && f.entry.bytes && f.entry.sha256 && f.mime) {
      return {
        ...entry,
        bytes: f.entry.bytes,
        sha256: f.entry.sha256,
        mime: f.mime,
        status: 'downloaded',
      };
    }
    return {
      ...entry,
      status: 'failed',
      failureCode: f.failureCode ?? MQX.ASSET_NETWORK,
    };
  });
}

function sanitizeFilename(input: string): string {
  // Strip path separators, quotes, and control characters; cap to 64 chars.
  const safe = input
    .replace(/[\\/:"*?<>|\x00-\x1f]+/g, '_')
    .replace(/\s+/g, '-')
    .slice(0, 64)
    .replace(/^[-_]+|[-_]+$/g, '') || 'quiz';
  return redactString(safe);
}

/** Return a copy of `doc` where every asset's `localPath` is filled in
 *  from the matching `plan.entries` entry. The renderer needs the
 *  `localPath` to render `[IMAGEN](./quiz/qN-…)`; without this pass it
 *  falls back to the URL basename. */
function propagateLocalPaths(doc: QuizDocument, plan: AssetPlan): QuizDocument {
  const byUrl = new Map<string, AssetEntry>();
  for (const e of plan.entries) byUrl.set(e.sourceUrl, e);
  return {
    ...doc,
    questions: doc.questions.map((q) => ({
      ...q,
      assets: q.assets.map((a) => {
        const planEntry = byUrl.get(a.sourceUrl);
        if (!planEntry) return a;
        return {
          ...a,
          localPath: planEntry.localPath,
          sha256: planEntry.sha256 ?? a.sha256,
          bytes: planEntry.bytes?.byteLength ?? a.bytes,
          mime: planEntry.mime ?? a.mime,
          status: planEntry.status,
        };
      }),
    })),
  };
}

// Local import to keep the file self-contained without breaking the layer
// rule that says `background/` should not depend on `export/`. The renderer
// is a stable contract — we can safely call it.
import { renderQuiz } from '~/export/markdown';