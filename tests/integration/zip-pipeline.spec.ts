// tests/integration/zip-pipeline.spec.ts
//
// End-to-end ZIP pipeline test on the `dsop-02` fixture, which is the only
// redacted fixture that contains a prompt image (q2 references
// `A2_Examen_U1.png`). The test:
//   1. parses the fixture into a QuizDocument
//   2. runs the orchestrator with a stub `AssetFetcher` and a fake
//      `DownloadService`
//   3. unzips the resulting bytes and asserts the layout
//
// This validates the contract documented in `docs/ARCHITECTURE.md` §Fases
// Fase 2 without ever touching the browser API.

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { unzipSync, strFromU8 } from 'fflate';
import { createDomAdapter } from '~/moodle/dom-adapter';
import { parseQuestion } from '~/moodle/parsers/registry';
import { fingerprint } from '~/domain/quiz-schema';
import { buildQuizDocument } from '~/export/source';
import { runZipPipeline } from '~/background/zip-orchestrator';
import { createAssetFetcher } from '~/background/asset-fetch-client';
import { ManifestSchema } from '~/domain/manifest-schema';

const FIXTURE = 'tests/fixtures/redacted/dsop-02-page-01.html';

const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52,
]);

async function buildDoc() {
  const html = await readFile(FIXTURE, 'utf8');
  const { window } = new JSDOM(html, {
    url: 'https://ejemplo.mx/mod/quiz/attempt.php?attempt=__REDACTED__&cmid=__REDACTED__',
  });
  const dom = createDomAdapter(window.document);
  const warns: Array<{ code: string; stage: 'parse'; message: string }> = [];
  const questions = await Promise.all(
    dom.listQuestions().map((q) =>
      parseQuestion(q, {
        fingerprint,
        warn: (code, message) => warns.push({ code, stage: 'parse', message }),
      }),
    ),
  );
  return buildQuizDocument(dom, questions, warns);
}

function stubFetchFactory() {
  return (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    return Promise.resolve(
      new Response(PNG_BYTES, {
        status: 200,
        headers: { 'content-type': 'image/png' },
        // `Response.url` is read-only; fake it via Response.redirect instead.
        // The test only checks status/content-type, not redirect-to-login.
      }),
    ) as unknown as Promise<Response>;
  };
}

function stubDownloader() {
  return {
    async downloadZip(bytes: Uint8Array, filename: string) {
      return { id: 42, filename, blobUrl: 'blob:test' };
    },
  };
}

describe('ZIP pipeline (Fase 2 — end to end on dsop-02)', () => {
  it('produces a ZIP with quiz.md, quiz.json, manifest.json, and the image', async () => {
    const doc = await buildDoc();
    const fetcher = createAssetFetcher('*://*/*', stubFetchFactory() as typeof fetch);
    const result = await runZipPipeline({
      doc,
      fetcher,
      downloader: stubDownloader(),
      generatorVersion: '0.2.0-test',
      archiveBaseName: 'DSOP-Test',
      now: new Date('2026-07-15T00:00:00Z'),
    });

    expect(result.counts.assetsTotal).toBeGreaterThanOrEqual(1);
    expect(result.counts.assetsDownloaded).toBeGreaterThanOrEqual(1);
    expect(result.download.filename).toBe('DSOP-Test.zip');
    expect(result.zip.byteLength).toBeGreaterThan(0);

    const files = unzipSync(result.zip);
    expect(files['README.txt']).toBeDefined();
    expect(files['quiz.md']).toBeDefined();
    expect(files['quiz.json']).toBeDefined();
    expect(files['manifest.json']).toBeDefined();

    const md = strFromU8(files['quiz.md']!);
    expect(md).toContain('[IMAGEN](./quiz/q2-');

    const json = JSON.parse(strFromU8(files['quiz.json']!));
    expect(json.schemaVersion).toBe('1.0');
    expect(json.questions).toHaveLength(10);

    const manifestJson = JSON.parse(strFromU8(files['manifest.json']!));
    expect(() => ManifestSchema.parse(manifestJson)).not.toThrow();
    expect(manifestJson.counts.assetsTotal).toBe(
      result.counts.assetsTotal,
    );
    expect(manifestJson.counts.assetsDownloaded).toBe(
      result.counts.assetsDownloaded,
    );

    const assetPaths = Object.keys(files).filter((p) => p.startsWith('quiz/'));
    expect(assetPaths.length).toBeGreaterThanOrEqual(1);
    const imageBytes = files[assetPaths[0]!]!;
    expect(Array.from(imageBytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('redacts any leak before serializing — even when the doc leaks', async () => {
    const doc = await buildDoc();
    // Force a leak: replace the prompt with a string that contains a sesskey.
    doc.questions[0]!.promptMarkdown = 'sesskey=REALleakValueABCDEF';
    const fetcher = createAssetFetcher('*://*/*', stubFetchFactory() as typeof fetch);
    await expect(
      runZipPipeline({
        doc,
        fetcher,
        downloader: stubDownloader(),
        generatorVersion: '0.2.0-test',
        archiveBaseName: 'DSOP-Test',
        now: new Date('2026-07-15T00:00:00Z'),
      }),
    ).rejects.toThrowError(/MQX-PRIV-401/);
  });

  it('skips assets that the fetcher reports as failed and surfaces a warning', async () => {
    const doc = await buildDoc();
    const failingFetcher = {
      async fetchAll(entries: ReadonlyArray<import('~/export/asset-planner').AssetEntry>) {
        return entries.map((entry) => ({
          entry,
          status: 'failed' as const,
          failureCode: 'MQX-ASSET-203' as const,
          errorMessage: 'simulated network error',
        }));
      },
      async fetchOne(entry: import('~/export/asset-planner').AssetEntry) {
        return {
          entry,
          status: 'failed' as const,
          failureCode: 'MQX-ASSET-203' as const,
          errorMessage: 'simulated network error',
        };
      },
    };
    const result = await runZipPipeline({
      doc,
      fetcher: failingFetcher,
      downloader: stubDownloader(),
      generatorVersion: '0.2.0-test',
      archiveBaseName: 'DSOP-Test',
      now: new Date('2026-07-15T00:00:00Z'),
    });
    expect(result.counts.assetsFailed).toBe(result.counts.assetsTotal);
    // Markdown still contains the literal [IMAGEN] line, pointing at the
    // empty localPath so the user knows the asset is missing.
    const files = unzipSync(result.zip);
    const md = strFromU8(files['quiz.md']!);
    expect(md).toContain('[IMAGEN]');
    const manifestJson = JSON.parse(strFromU8(files['manifest.json']!));
    expect(manifestJson.warnings.length).toBeGreaterThanOrEqual(1);
  });
});