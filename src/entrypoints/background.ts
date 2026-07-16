// src/entrypoints/background.ts
//
// Background service worker: receives `zipQuiz` messages from the content
// script, requests the `pluginfile.php` origin permission when needed,
// runs the authenticated ZIP pipeline, and triggers the download.
//
// The full `QuizDocument` is passed across the boundary (Zod-validated at
// both ends). The asset fetch happens in this context so the existing
// Moodle session cookie is forwarded by the browser automatically.

import { runZipPipeline } from '~/background/zip-orchestrator';
import { createAssetFetcher } from '~/background/asset-fetch-client';
import { createDownloadService } from '~/background/download-service';
import {
  probeAssetPermission,
  requestAssetPermission,
} from '~/permissions/asset-permissions';
import { QuizDocumentSchema, type QuizDocument } from '~/domain/quiz-schema';
import type { ZipResult } from '~/messaging/runtime-messages';

const GENERATOR_VERSION = '0.2.0';

export default defineBackground(() => {
  // eslint-disable-next-line no-console
  console.log('[moodle-quiz-extractor] background started');

  browser.runtime.onMessage.addListener(
    (raw: unknown, _sender, sendResponse: (response: ZipResult) => void) => {
      if (!raw || (raw as { kind?: string }).kind !== 'zipQuiz') return false;
      const parsed = QuizDocumentSchema.safeParse(
        (raw as { document?: unknown }).document,
      );
      if (!parsed.success) {
        sendResponse({
          kind: 'zipResult',
          ok: false,
          error: 'invalid QuizDocument payload',
        });
        return false;
      }
      void runForDocument(parsed.data).then(sendResponse).catch((err: Error) => {
        sendResponse({ kind: 'zipResult', ok: false, error: err.message });
      });
      return true;
    },
  );
});

async function runForDocument(doc: QuizDocument): Promise<ZipResult> {
  const probe = await probeAssetPermission(
    `https://${doc.source.originHash.slice(0, 8)}.invalid/`,
    { permissions: browser.permissions as { contains?: (p: { origins?: string[] }) => Promise<boolean> } },
  );
  // We can't reconstruct the live URL from the origin hash alone; the popup
  // is responsible for capturing the current page URL and passing it in via
  // a richer message. For Phase 2 we keep the simple contract and ask the
  // user to grant the wildcard fallback (only after a user click on the
  // popup). When the user pre-authorized `<all_urls>` in the install
  // dialog, this is a no-op.
  if (!probe.alreadyGranted) {
    const granted = await requestAssetPermission('<all_urls>', {
      permissions: browser.permissions as { request?: (p: { origins: string[] }) => Promise<boolean> },
    });
    if (!granted.granted) {
      return {
        kind: 'zipResult',
        ok: false,
        error: 'Permission denied for pluginfile.php origin',
      };
    }
  }
  const originPattern = '*://*/*';
  const fetcher = createAssetFetcher(originPattern, fetch.bind(globalThis));
  const downloader = createDownloadService(browser as unknown as Parameters<typeof createDownloadService>[0]);
  const out = await runZipPipeline({
    doc,
    fetcher,
    downloader,
    generatorVersion: GENERATOR_VERSION,
    archiveBaseName: doc.title,
  });
  return {
    kind: 'zipResult',
    ok: true,
    filename: out.download.filename,
    counts: out.counts,
    warnings: out.warnings.map((w) => `${w.code}: ${w.message}`),
  };
}