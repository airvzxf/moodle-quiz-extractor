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
  CollectDiagnosticsRequestSchema,
  DownloadFixtureRequestSchema,
  type DownloadFixtureResult,
  LoadPopupSessionRequestSchema,
  type LoadPopupSessionResult,
  LogDiagnosticsEventRequestSchema,
  type LogDiagnosticsEventResult,
  PreviewFixtureRequestSchema,
  type PreviewFixtureResult,
  SafeReportResultSchema,
  type SafeReportResult,
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
import { DiagnosticsStore } from '~/background/diagnostics-store';
import { buildSafeReport } from '~/diagnostics/safe-report';
import { buildFixtureBundle, FixtureBundleError } from '~/diagnostics/fixture-builder';
import { findCanaryLeaks } from '~/diagnostics/canary-patterns';
import { RingBufferLogger } from '~/diagnostics/logger';

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

let diagnosticsStore: DiagnosticsStore | null = null;
function getDiagnosticsStore(): DiagnosticsStore {
  if (!diagnosticsStore) {
    diagnosticsStore = new DiagnosticsStore(new BrowserStorageSessionAdapter());
  }
  return diagnosticsStore;
}

export default defineBackground(() => {
  // eslint-disable-next-line no-console
  console.log('[moodle-quiz-extractor] background started');

  // Tab lifecycle: drop the diagnostics ring when a tab closes so we
  // never leak state across sessions.
  browser.tabs?.onRemoved?.addListener?.((tabId: number) => {
    void getDiagnosticsStore().delete(tabId).catch(() => undefined);
  });

  browser.runtime.onMessage.addListener(
    (raw: unknown, sender, sendResponse: (response: unknown) => void) => {
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

      if (kind === 'logDiagnosticsEvent') {
        const req = LogDiagnosticsEventRequestSchema.safeParse(raw);
        if (!req.success) {
          const result: LogDiagnosticsEventResult = {
            kind: 'logDiagnosticsEventResult',
            ok: false,
            error: 'malformed event',
          };
          sendResponse(result);
          return false;
        }
        // Stamp ts from the background clock and derive tabId from
        // sender.tab.id. NEVER trust the tabId the content script sent.
        const senderTabId = sender?.tab?.id ?? req.data.tabId;
        const ts = Date.now();
        void getDiagnosticsStore()
          .append(senderTabId, req.data.input, ts)
          .then(() => {
            const result: LogDiagnosticsEventResult = {
              kind: 'logDiagnosticsEventResult',
              ok: true,
            };
            sendResponse(result);
          })
          .catch((err: Error) => {
            const result: LogDiagnosticsEventResult = {
              kind: 'logDiagnosticsEventResult',
              ok: false,
              error: err.message,
            };
            sendResponse(result);
          });
        return true;
      }

      if (kind === 'collectDiagnostics') {
        const req = CollectDiagnosticsRequestSchema.safeParse(raw);
        if (!req.success) {
          const result: SafeReportResult = SafeReportResultSchema.parse({
            kind: 'safeReportResult',
            ok: false,
            error: 'malformed request',
          });
          sendResponse(result);
          return false;
        }
        const senderTabId = sender?.tab?.id ?? req.data.tabId;
        void buildReportForTab(senderTabId).then(sendResponse).catch((err: Error) => {
          const result: SafeReportResult = SafeReportResultSchema.parse({
            kind: 'safeReportResult',
            ok: false,
            error: err.message,
          });
          sendResponse(result);
        });
        return true;
      }

      if (kind === 'previewFixture') {
        const req = PreviewFixtureRequestSchema.safeParse(raw);
        if (!req.success) {
          const result: PreviewFixtureResult = {
            kind: 'previewFixtureResult',
            ok: false,
            error: 'malformed request',
          };
          sendResponse(result);
          return false;
        }
        const senderTabId = sender?.tab?.id ?? req.data.tabId;
        void previewFixtureForTab(senderTabId).then(sendResponse).catch((err: Error) => {
          const result: PreviewFixtureResult = {
            kind: 'previewFixtureResult',
            ok: false,
            error: err.message,
          };
          sendResponse(result);
        });
        return true;
      }

      if (kind === 'downloadFixture') {
        const req = DownloadFixtureRequestSchema.safeParse(raw);
        if (!req.success) {
          const result: DownloadFixtureResult = {
            kind: 'downloadFixtureResult',
            ok: false,
            error: 'malformed request',
          };
          sendResponse(result);
          return false;
        }
        const senderTabId = sender?.tab?.id ?? req.data.tabId;
        if (req.data.ackCanaryHits.length > 0) {
          const result: DownloadFixtureResult = {
            kind: 'downloadFixtureResult',
            ok: false,
            refusedReason: 'canary-detected',
            error: 'canary hits detected; refuse to ship bundle',
          };
          sendResponse(result);
          return true;
        }
        void downloadFixtureForTab(senderTabId).then(sendResponse).catch((err: Error) => {
          const result: DownloadFixtureResult = {
            kind: 'downloadFixtureResult',
            ok: false,
            error: err.message,
          };
          sendResponse(result);
        });
        return true;
      }

      if (kind === 'getFixtureSnapshot') {
        const senderTabId = sender?.tab?.id ?? 0;
        if (senderTabId <= 0) {
          sendResponse({ ok: false, error: 'no sender tab' });
          return true;
        }
        void handleGetFixtureSnapshot(senderTabId, sendResponse);
        return true;
      }

      return false;
    },
  );
});

async function captureRawHtml(tabId: number): Promise<string | null> {
  // The background asks the content script for the live document HTML
  // and uses it as the source for the tier-2 fixture pipeline. We
  // forward through the content script's onMessage listener so the
  // sender.tab is always the originating tab (no spoofable `tabId`).
  try {
    const res = (await browser.tabs?.sendMessage(tabId, {
      kind: 'getFixtureSnapshot',
      tabId,
    })) as { ok: boolean; html?: string; error?: string } | undefined;
    if (!res || !res.ok || typeof res.html !== 'string') {
      return null;
    }
    return res.html;
  } catch {
    return null;
  }
}

async function handleGetFixtureSnapshot(
  tabId: number,
  sendResponse: (response: unknown) => void,
): Promise<void> {
  try {
    const res = (await browser.tabs?.sendMessage(tabId, {
      kind: 'getFixtureSnapshot',
      tabId,
    })) as { ok: boolean; html?: string; error?: string } | undefined;
    if (!res || !res.ok || typeof res.html !== 'string') {
      sendResponse({ ok: false, error: res?.error ?? 'empty snapshot' });
      return;
    }
    sendResponse({ ok: true, html: res.html });
  } catch (err) {
    sendResponse({
      ok: false,
      error: err instanceof Error ? err.message : 'snapshot failed',
    });
  }
}

async function buildReportForTab(tabId: number): Promise<SafeReportResult> {
  const store = getDiagnosticsStore();
  const ring = await store.load(tabId);
  if (!ring) {
    return SafeReportResultSchema.parse({
      kind: 'safeReportResult',
      ok: true,
      report: {
        schemaVersion: '1.4.0',
        generator: 'moodle-quiz-extractor',
        generatorVersion: GENERATOR_VERSION,
        manifestVersion: 3,
        exportedAt: new Date().toISOString(),
        ring: { capacity: 200, length: 0, dropped: 0 },
        counts: { events: 0, byStage: {}, byCode: {} },
        recentCodes: [],
        truncated: false,
      },
    });
  }
  const report = buildSafeReport({
    ring,
    generatorVersion: GENERATOR_VERSION,
    manifestVersion: 3,
  });
  return SafeReportResultSchema.parse({
    kind: 'safeReportResult',
    ok: true,
    report,
  });
}

async function previewFixtureForTab(tabId: number): Promise<PreviewFixtureResult> {
  const rawHtml = await captureRawHtml(tabId);
  if (rawHtml === null) {
    return {
      kind: 'previewFixtureResult',
      ok: false,
      error: 'no fixture available (content script did not return HTML)',
    };
  }
  const ring = await getDiagnosticsStore().load(tabId);
  try {
    const built = buildFixtureBundle({
      rawHtml,
      safeReportInput: {
        ring: ring ?? RingBufferLogger.empty(),
        generatorVersion: GENERATOR_VERSION,
        manifestVersion: 3,
      },
    });
    const hits = findCanaryLeaks(built.sanitized.html);
    return {
      kind: 'previewFixtureResult',
      ok: true,
      preview: {
        bytes: built.bytes.length,
        canaryHits: hits.map((h) => h.label),
        entryCount: 2,
      },
    };
  } catch (err) {
    if (err instanceof FixtureBundleError) {
      return {
        kind: 'previewFixtureResult',
        ok: false,
        error: err.message,
      };
    }
    throw err;
  }
}

async function downloadFixtureForTab(tabId: number): Promise<DownloadFixtureResult> {
  const rawHtml = await captureRawHtml(tabId);
  if (rawHtml === null) {
    return {
      kind: 'downloadFixtureResult',
      ok: false,
      refusedReason: 'unavailable',
      error: 'no fixture available',
    };
  }
  const ring = await getDiagnosticsStore().load(tabId);
  let built;
  try {
    built = buildFixtureBundle({
      rawHtml,
      safeReportInput: {
        ring: ring ?? RingBufferLogger.empty(),
        generatorVersion: GENERATOR_VERSION,
        manifestVersion: 3,
      },
    });
  } catch (err) {
    if (err instanceof FixtureBundleError) {
      return {
        kind: 'downloadFixtureResult',
        ok: false,
        refusedReason: 'unavailable',
        error: err.message,
      };
    }
    throw err;
  }
  const finalCheck = findCanaryLeaks(JSON.stringify(built.safeReport));
  if (finalCheck.length > 0) {
    return {
      kind: 'downloadFixtureResult',
      ok: false,
      refusedReason: 'canary-detected',
      error: 'safe report contains canary patterns',
    };
  }
  const downloader = createDownloadService(
    browser as unknown as Parameters<typeof createDownloadService>[0],
  );
  await downloader.downloadZip(built.bytes, built.filename);
  return {
    kind: 'downloadFixtureResult',
    ok: true,
    filename: built.filename,
    bytes: built.bytes.length,
  };
}

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