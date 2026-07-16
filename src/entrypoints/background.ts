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
  originPatternFor,
  probeAssetPermission,
  requestAssetPermission,
} from '~/permissions/asset-permissions';
import { QuizDocumentSchema, type QuizDocument } from '~/domain/quiz-schema';
import {
  ClearPopupSessionRequestSchema,
  type ClearPopupSessionResult,
  LoadPopupSessionRequestSchema,
  type LoadPopupSessionResult,
  SavePopupSessionRequestSchema,
  type SavePopupSessionRequest,
  type SavePopupSessionResult,
  type ZipResult,
} from '~/messaging/runtime-messages';
import {
  BrowserStorageSessionAdapter,
} from '~/background/job-store';
import {
  PopupSessionStore,
  POPUP_SESSION_SCHEMA_VERSION,
  type PopupSessionState,
} from '~/background/popup-session-store';

const GENERATOR_VERSION = '0.3.0';

// Module-level singleton so the popup's state survives across
// background-script Wakes (MV3 may unload the SW between events).
let popupSessionStore: PopupSessionStore | null = null;
function getPopupSessionStore(): PopupSessionStore {
  if (!popupSessionStore) {
    popupSessionStore = new PopupSessionStore(new BrowserStorageSessionAdapter());
  }
  return popupSessionStore;
}

export default defineBackground(() => {
  // eslint-disable-next-line no-console
  console.log('[moodle-quiz-extractor] background started');

  browser.runtime.onMessage.addListener(
    (raw: unknown, _sender, sendResponse: (response: unknown) => void) => {
      if (!raw || typeof (raw as { kind?: string }).kind !== 'string') return false;

      const kind = (raw as { kind: string }).kind;

      if (kind === 'zipQuiz') {
        const parsed = QuizDocumentSchema.safeParse(
          (raw as { document?: unknown }).document,
        );
        if (!parsed.success) {
          const result: ZipResult = {
            kind: 'zipResult',
            ok: false,
            error: 'invalid QuizDocument payload',
          };
          sendResponse(result);
          return false;
        }
        const tabUrl = typeof (raw as { tabUrl?: unknown }).tabUrl === 'string'
          ? (raw as { tabUrl: string }).tabUrl
          : undefined;
        void runForDocument(parsed.data, tabUrl).then(sendResponse).catch((err: Error) => {
          sendResponse({ kind: 'zipResult', ok: false, error: err.message });
        });
        return true;
      }

      if (kind === 'loadPopupSession') {
        const req = LoadPopupSessionRequestSchema.safeParse(raw);
        if (!req.success) {
          const result: LoadPopupSessionResult = {
            kind: 'loadPopupSessionResult',
            found: false,
            reason: 'malformed',
          };
          sendResponse(result);
          return false;
        }
        void getPopupSessionStore()
          .load(req.data.tabId, req.data.originHash)
          .then((r) => {
            const result: LoadPopupSessionResult = {
              kind: 'loadPopupSessionResult',
              found: r.state !== null,
              state: r.state ?? undefined,
              reason: r.reason,
            };
            sendResponse(result);
          })
          .catch(() => {
            const result: LoadPopupSessionResult = {
              kind: 'loadPopupSessionResult',
              found: false,
              reason: 'malformed',
            };
            sendResponse(result);
          });
        return true;
      }

      if (kind === 'savePopupSession') {
        const req = SavePopupSessionRequestSchema.safeParse(raw);
        if (!req.success) {
          const result: SavePopupSessionResult = {
            kind: 'savePopupSessionResult',
            ok: false,
          };
          sendResponse(result);
          return false;
        }
        void handleSavePopupSession(req.data).then(sendResponse).catch(() => {
          const result: SavePopupSessionResult = {
            kind: 'savePopupSessionResult',
            ok: false,
          };
          sendResponse(result);
        });
        return true;
      }

      if (kind === 'clearPopupSession') {
        const req = ClearPopupSessionRequestSchema.safeParse(raw);
        if (!req.success) {
          const result: ClearPopupSessionResult = {
            kind: 'clearPopupSessionResult',
            ok: false,
          };
          sendResponse(result);
          return false;
        }
        void getPopupSessionStore()
          .delete(req.data.tabId)
          .then(() => {
            const result: ClearPopupSessionResult = {
              kind: 'clearPopupSessionResult',
              ok: true,
            };
            sendResponse(result);
          });
        return true;
      }

      return false;
    },
  );
});

async function handleSavePopupSession(
  req: SavePopupSessionRequest,
): Promise<SavePopupSessionResult> {
  const state: PopupSessionState = {
    schemaVersion: POPUP_SESSION_SCHEMA_VERSION,
    originHash: req.originHash,
    savedAt: Date.now(),
    answersText: req.state.answersText,
    lastDocumentJson: req.state.lastDocumentJson,
    lastJobId: req.state.lastJobId,
    hasAutofillContext: req.state.hasAutofillContext,
  };
  const saved = await getPopupSessionStore().save(req.tabId, state);
  return {
    kind: 'savePopupSessionResult',
    ok: true,
    savedAt: saved.savedAt,
  };
}

/**
 * Run the ZIP pipeline for a single document. The optional `tabUrl` is the
 * live URL of the tab that originated the request (captured by the content
 * script). When present and well-formed, we ask for a permission scoped to
 * that page's origin only. When absent (older content scripts, or test
 * callers), we keep the legacy fallback: ask for `<all_urls>` once the user
 * clicks "Descargar ZIP", and log a warning so the user can diagnose.
 */
export async function runForDocument(
  doc: QuizDocument,
  tabUrl?: string,
): Promise<ZipResult> {
  const originPattern = tabUrl ? originPatternFor(tabUrl) : '';
  const permissionsApi = {
    permissions: browser.permissions as unknown as {
      contains?: (p: { origins?: string[] }) => Promise<boolean>;
      request?: (p: { origins: string[] }) => Promise<boolean>;
    },
  };

  if (originPattern) {
    const probe = await probeAssetPermission(tabUrl!, permissionsApi);
    if (!probe.alreadyGranted) {
      const granted = await requestAssetPermission(tabUrl!, permissionsApi);
      if (!granted.granted) {
        return {
          kind: 'zipResult',
          ok: false,
          error: 'Permission denied for pluginfile.php origin',
        };
      }
    }
  } else {
    // Legacy fallback: no live URL was forwarded. Keep the previous
    // behavior (ask for `<all_urls>` once the user clicks "Descargar ZIP")
    // so older callers still work, but warn the user via the result
    // warnings list.
    // eslint-disable-next-line no-console
    console.warn(
      '[moodle-quiz-extractor] zipQuiz arrived without tabUrl; falling back to <all_urls>',
    );
    const granted = await requestAssetPermission('<all_urls>', permissionsApi);
    if (!granted.granted) {
      return {
        kind: 'zipResult',
        ok: false,
        error: 'Permission denied for pluginfile.php origin',
      };
    }
  }

  const fetcherOriginPattern = originPattern || '*://*/*';
  const fetcher = createAssetFetcher(fetcherOriginPattern, fetch.bind(globalThis));
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