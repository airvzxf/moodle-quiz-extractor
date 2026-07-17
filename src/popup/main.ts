// src/popup/main.ts
//
// Popup entrypoint script. Wired from `src/entrypoints/popup.html`
// via `<script type="module" src="../../popup/main.ts">`. Kept out of
// `src/entrypoints/` so WXT 0.20.27 does not pick it up as a separate
// `unlisted-script` entrypoint (its glob matches every `*.ts` file
// inside `entrypoints/`).
//
// Communication contract:
//   1. detect     → { kind: 'extractQuiz' }                (content → here)
//   2. download   → { kind: 'zipQuiz', document, tabUrl } (here → background)
//   3. result     → { kind: 'zipResult', ok, ... }         (background → here)
//   4. autofill   → { kind: 'prepareAutofill', jobId, answersText } (here → content)
//   5. apply      → { kind: 'applyAutofill', jobId }       (here → content)
//   6. abort      → { kind: 'abortAutofill', jobId }       (here → content)
//   7. persistence → { kind: 'loadPopupSession' / 'savePopupSession' / 'clearPopupSession' }
//                   The popup stores its work-in-progress state in
//                   storage.session via the background so switching
//                   windows does not lose progress (MV3 destroys the
//                   popup on blur).

import type { QuizDocument } from '~/domain/quiz-schema';
import type {
  ApplyAutofillResult,
  ClearPopupSessionResult,
  GetAutofillJobResult,
  LoadPopupSessionResult,
  PrepareAutofillResult,
  QuizDocumentMessage,
  SafeReportResult,
  SavePopupSessionRequest,
  SavePopupSessionResult,
  ZipResult,
} from '~/messaging/runtime-messages';
import type { SafeReport } from '~/diagnostics/diagnostics-types';

interface RuntimeApi {
  tabs?: {
    query: (
      q: { active: boolean; currentWindow: boolean },
    ) => Promise<Array<{ id?: number; url?: string }>>;
    sendMessage: (
      tabId: number,
      message: unknown,
    ) => Promise<unknown>;
  };
  runtime?: {
    sendMessage: (message: unknown) => Promise<unknown>;
    lastError?: { message?: string };
  };
}

const api: RuntimeApi = browser;

interface PopupState {
  lastDocument: QuizDocument | null;
  lastJobId: string | null;
  /** Tab id where the last extraction happened (for persistence key). */
  contextTabId: number | null;
  /** SHA-256 of the live origin (for persistence key). */
  contextOriginHash: string | null;
  /** True when the textarea has text or a job was prepared. */
  hasAutofillContext: boolean;
}

const state: PopupState = {
  lastDocument: null,
  lastJobId: null,
  contextTabId: null,
  contextOriginHash: null,
  hasAutofillContext: false,
};

const PERSIST_DEBOUNCE_MS = 150;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function setStatus(text: string, st: 'idle' | 'busy' | 'ok' | 'error'): void {
  const status = document.getElementById('status');
  if (!status) return;
  status.textContent = text;
  status.dataset.state = st;
}

interface ActiveTabInfo {
  readonly id: number;
  readonly url: string | undefined;
}

async function getActiveTab(): Promise<ActiveTabInfo | null> {
  try {
    const tabs = await api.tabs?.query({ active: true, currentWindow: true });
    const tab = tabs?.[0];
    if (!tab || typeof tab.id !== 'number') return null;
    const url = typeof tab.url === 'string' ? tab.url : undefined;
    return { id: tab.id, url };
  } catch {
    return null;
  }
}

async function computeOriginHash(url: string | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (typeof globalThis.crypto?.subtle?.digest === 'function') {
      const buf = new TextEncoder().encode(u.origin);
      const digest = await globalThis.crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {
    return null;
  }
  return null;
}

async function askContentForDocument(tabId: number): Promise<QuizDocument | null> {
  const reply = (await api.tabs?.sendMessage(tabId, {
    kind: 'extractQuiz',
  })) as QuizDocumentMessage | undefined;
  if (!reply || reply.kind !== 'quizDocument' || !reply.document) {
    setStatus('Esta pestaña no parece un intento de cuestionario Moodle.', 'error');
    return null;
  }
  return reply.document as QuizDocument;
}

async function sendToContent<T>(tabId: number, message: unknown): Promise<T | null> {
  return (await api.tabs?.sendMessage(tabId, message)) as T | null;
}

async function sendToBackground<T>(message: unknown): Promise<T | null> {
  return (await api.runtime?.sendMessage(message)) as T | null;
}

function generateJobId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback (very old runtimes): random hex.
  let s = '';
  for (let i = 0; i < 32; i++) {
    s += Math.floor(Math.random() * 16).toString(16);
  }
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

function switchTab(name: string): void {
  for (const tab of document.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
    const isActive = tab.dataset['tab'] === name;
    tab.setAttribute('aria-selected', String(isActive));
    if (isActive) {
      tab.removeAttribute('disabled');
    }
  }
  for (const panel of document.querySelectorAll<HTMLElement>('.tab-panel')) {
    panel.dataset['active'] = String(panel.dataset['tab'] === name);
  }
}

function wireTabs(): void {
  for (const tab of document.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
    tab.addEventListener('click', () => {
      if (tab.hasAttribute('disabled')) return;
      const name = tab.dataset['tab'];
      if (name) switchTab(name);
    });
  }
}

// ---------------------------------------------------------------------------
// Persistence: the popup stores its work-in-progress state in
// `storage.session` via the background so that switching windows does not
// lose progress. The background holds the actual store
// (PopupSessionStore in src/background/popup-session-store.ts); the popup
// just sends the load/save/clear messages.
// ---------------------------------------------------------------------------

function buildPersistPayload(): SavePopupSessionRequest | null {
  if (state.contextTabId === null || state.contextOriginHash === null) return null;
  const input = document.getElementById('answers-input') as HTMLTextAreaElement | null;
  return {
    kind: 'savePopupSession',
    tabId: state.contextTabId,
    originHash: state.contextOriginHash,
    state: {
      answersText: input?.value ?? '',
      lastDocumentJson: state.lastDocument ? JSON.stringify(state.lastDocument) : '',
      lastJobId: state.lastJobId,
      hasAutofillContext: state.hasAutofillContext,
    },
  };
}

/**
 * Save the popup state to storage.session. We do NOT debounce the actual
 * write because Firefox MV3 destroys the popup abruptly on blur, cancelling
 * any pending setTimeout. Saves are fast (in-memory write + a single
 * async storage.session.set, fire-and-forget). The `input` listener for
 * the textarea is the only high-frequency trigger; we coalesce by
 * skipping if a save was just sent in the last PERSIST_DEBOUNCE_MS.
 */
function persistNow(): void {
  const payload = buildPersistPayload();
  if (!payload) return;
  void sendToBackground<SavePopupSessionResult>(payload);
}

function schedulePersist(): void {
  if (persistTimer !== null) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    // No-op: persistNow is called directly on each state change.
  }, PERSIST_DEBOUNCE_MS);
  persistNow();
}

async function flushPersist(): Promise<void> {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  persistNow();
}

async function clearPersistedState(reason: 'user-cancel' | 'validate-failed' | 'hydrate-prepare-failed'): Promise<void> {
  if (state.contextTabId === null || state.contextOriginHash === null) return;
  void sendToBackground<ClearPopupSessionResult>({
    kind: 'clearPopupSession',
    tabId: state.contextTabId,
    originHash: state.contextOriginHash,
  });
}

/**
 * Try to restore a previous session. If the storage has a valid state
 * for the current tab+origin, hydrate `state`, restore the textarea,
 * and (silently) re-run `prepareAutofill` so the in-memory job is
 * rebuilt in the content script (the SW may have been restarted since
 * the popup was last closed).
 */
async function hydrate(): Promise<void> {
  const tab = await getActiveTab();
  if (tab === null) return;
  const originHash = await computeOriginHash(tab.url);
  if (!originHash) return;

  const res = (await sendToBackground<LoadPopupSessionResult>({
    kind: 'loadPopupSession',
    tabId: tab.id,
    originHash,
  })) as LoadPopupSessionResult | null;
  if (!res || !res.found || !res.state) return;

  const candidate = res.state as {
    answersText?: unknown;
    lastDocumentJson?: unknown;
    lastJobId?: unknown;
    hasAutofillContext?: unknown;
  };
  if (typeof candidate.answersText !== 'string') return;

  const input = document.getElementById('answers-input') as HTMLTextAreaElement | null;
  const btnZip = document.getElementById('download-zip') as HTMLButtonElement | null;
  const btnApply = document.getElementById('autofill-apply') as HTMLButtonElement | null;
  const btnCancel = document.getElementById('autofill-cancel') as HTMLButtonElement | null;

  state.contextTabId = tab.id;
  state.contextOriginHash = originHash;
  state.hasAutofillContext = Boolean(candidate.hasAutofillContext);

  if (input) input.value = candidate.answersText;

  // Restore the extracted QuizDocument (best-effort parse).
  if (typeof candidate.lastDocumentJson === 'string' && candidate.lastDocumentJson.length > 0) {
    try {
      const parsed = JSON.parse(candidate.lastDocumentJson) as QuizDocument;
      state.lastDocument = parsed;
      if (btnZip) btnZip.disabled = false;
      setStatus(`Detectado: ${parsed.title} — ${parsed.questions.length} pregunta(s).`, 'ok');
    } catch {
      state.lastDocument = null;
    }
  }

  // The autofill job lives in the content script's in-memory map; that
  // map resets when Firefox restarts the SW. Silently re-prepare so the
  // user can keep working without an extra "Validar" click.
  if (
    state.hasAutofillContext &&
    typeof candidate.lastJobId === 'string' &&
    candidate.lastJobId.length > 0 &&
    state.lastDocument
  ) {
    state.lastJobId = candidate.lastJobId;
    setStatus('Restaurando trabajo anterior…', 'busy');
    const prep = (await sendToContent<PrepareAutofillResult>(tab.id, {
      kind: 'prepareAutofill',
      jobId: candidate.lastJobId,
      answersText: candidate.answersText,
    })) as PrepareAutofillResult | null;
    if (prep && prep.kind === 'prepareAutofillResult' && prep.ok) {
      const warnMsg = (prep.warnings ?? []).length > 0 ? ` (${prep.warnings!.length} aviso(s))` : '';
      setStatus(`Trabajo anterior restaurado. ${prep.stepCount ?? 0} pasos listos${warnMsg}. Pulsa "Aplicar respuestas" o "Cancelar".`, 'ok');
      if (btnApply) btnApply.disabled = false;
      if (btnCancel) btnCancel.disabled = false;
    } else if (prep && prep.kind === 'prepareAutofillResult' && !prep.ok) {
      setStatus(`Trabajo anterior restaurado, pero la validación falló: ${(prep.errors ?? []).join('; ')}`, 'error');
      state.lastJobId = null;
      state.hasAutofillContext = false;
      if (btnApply) btnApply.disabled = true;
      if (btnCancel) btnCancel.disabled = true;
      await clearPersistedState('hydrate-prepare-failed');
    }
  }
}

function wireExtract(): void {
  const btnExtract = document.getElementById('extract-current') as HTMLButtonElement | null;
  const btnZip = document.getElementById('download-zip') as HTMLButtonElement | null;
  if (!btnExtract || !btnZip) return;

  btnExtract.addEventListener('click', async () => {
    setStatus('Extrayendo…', 'busy');
    const tab = await getActiveTab();
    if (tab === null) {
      setStatus('No hay pestaña activa.', 'error');
      return;
    }
    const doc = await askContentForDocument(tab.id);
    if (!doc) return;
    state.lastDocument = doc;
    state.contextTabId = tab.id;
    state.contextOriginHash = await computeOriginHash(tab.url);
    setStatus(`Detectado: ${doc.title} — ${doc.questions.length} pregunta(s).`, 'ok');
    btnZip.disabled = false;
    schedulePersist();
  });

  btnZip.addEventListener('click', async () => {
    if (!state.lastDocument) return;
    setStatus('Descargando ZIP…', 'busy');
    btnZip.disabled = true;
    try {
      const tab = await getActiveTab();
      const tabUrl = tab?.url;
      const result = (await api.runtime?.sendMessage({
        kind: 'zipQuiz',
        document: state.lastDocument,
        tabUrl,
      })) as ZipResult | undefined;
      if (!result || result.kind !== 'zipResult') {
        throw new Error('respuesta inválida del background');
      }
      if (!result.ok) {
        setStatus(`Error: ${result.error ?? 'desconocido'}`, 'error');
        return;
      }
      const counts = result.counts ?? { assetsDownloaded: 0, assetsFailed: 0, assetsTotal: 0 };
      setStatus(
        `ZIP listo: ${result.filename} (${counts.assetsDownloaded}/${counts.assetsTotal} imágenes, ${counts.assetsFailed} con error).`,
        'ok',
      );
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`, 'error');
    } finally {
      btnZip.disabled = false;
    }
  });
}

function wireAutofill(): void {
  const input = document.getElementById('answers-input') as HTMLTextAreaElement | null;
  const btnValidate = document.getElementById('autofill-validate') as HTMLButtonElement | null;
  const btnApply = document.getElementById('autofill-apply') as HTMLButtonElement | null;
  const btnCancel = document.getElementById('autofill-cancel') as HTMLButtonElement | null;
  if (!input || !btnValidate || !btnApply || !btnCancel) return;

  // Persist textarea edits on every keystroke (coalesced via the
  // debounce timer; see schedulePersist).
  input.addEventListener('input', () => {
    state.hasAutofillContext = input.value.trim().length > 0;
    schedulePersist();
  });

  const tabId = async (): Promise<number | null> => {
    const tab = await getActiveTab();
    return tab?.id ?? null;
  };

  btnValidate.addEventListener('click', async () => {
    const text = input.value;
    if (!text.trim()) {
      setStatus('Pega tu lista de respuestas antes de validar.', 'error');
      return;
    }
    const tid = await tabId();
    if (tid === null) {
      setStatus('No hay pestaña activa.', 'error');
      return;
    }
    const jobId = generateJobId();
    setStatus('Validando respuestas…', 'busy');
    btnValidate.disabled = true;
    btnCancel.disabled = true;
    try {
      const res = (await sendToContent<PrepareAutofillResult>(tid, {
        kind: 'prepareAutofill',
        jobId,
        answersText: text,
      })) as PrepareAutofillResult | null;
      if (!res || res.kind !== 'prepareAutofillResult') {
        throw new Error('respuesta inválida del content script');
      }
      if (!res.ok) {
        setStatus(`Errores: ${(res.errors ?? []).join('; ')}`, 'error');
        state.lastJobId = null;
        state.hasAutofillContext = false;
        btnApply.disabled = true;
        btnCancel.disabled = true;
        await clearPersistedState('validate-failed');
        return;
      }
      state.lastJobId = jobId;
      state.hasAutofillContext = true;
      const warnMsg = (res.warnings ?? []).length > 0 ? ` (${res.warnings!.length} aviso(s))` : '';
      setStatus(`OK: ${res.stepCount ?? 0} pasos listos${warnMsg}. Pulsa "Aplicar respuestas" o "Cancelar".`, 'ok');
      btnApply.disabled = false;
      btnCancel.disabled = false;
      schedulePersist();
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`, 'error');
    } finally {
      btnValidate.disabled = false;
    }
  });

  btnApply.addEventListener('click', async () => {
    if (!state.lastJobId) return;
    const tid = await tabId();
    if (tid === null) return;
    setStatus('Aplicando…', 'busy');
    btnApply.disabled = true;
    try {
      const res = (await sendToContent<ApplyAutofillResult>(tid, {
        kind: 'applyAutofill',
        jobId: state.lastJobId,
      })) as ApplyAutofillResult | null;
      if (!res || res.kind !== 'applyAutofillResult') {
        throw new Error('respuesta inválida');
      }
      if (!res.ok) {
        setStatus(`Fallos: ${(res.errors ?? []).join('; ')}`, 'error');
        // Keep persisted state so the user can review/cancel after
        // window switches even when apply partially failed.
      } else {
        setStatus(`Listo: ${res.applied}/${res.total} controles aplicados. Revisa y envía manualmente.`, 'ok');
        // Keep the persisted state on success: the user must be able to
        // switch windows and come back to see the applied status.
        // Re-applying is idempotent (re-clicking already-checked radios
        // is a no-op). Cancel is the explicit "start over" path.
      }
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`, 'error');
    } finally {
      btnCancel.disabled = true;
      void sendToContent<GetAutofillJobResult>(tid, {
        kind: 'getAutofillJob',
        jobId: state.lastJobId ?? '',
      });
    }
  });

  /**
   * Cancel button. The user has validated but changed their mind (or
   * wants to start over after applying). We abort the in-memory job
   * (if any), clear the textarea, and reset to idle. The QuizDocument
   * detection (lastDocument) and the ZIP download button stay enabled
   * — re-detection is unrelated.
   */
  btnCancel.addEventListener('click', async () => {
    const tid = await tabId();
    if (tid === null) return;
    if (state.lastJobId) {
      await sendToContent(tid, { kind: 'abortAutofill', jobId: state.lastJobId });
      state.lastJobId = null;
    }
    input.value = '';
    state.hasAutofillContext = false;
    btnApply.disabled = true;
    btnCancel.disabled = true;
    setStatus('Cancelado. Pega otra lista o pulsa "Extraer página actual" para reiniciar.', 'idle');
    await clearPersistedState('user-cancel');
  });
}

function wirePersistenceLifecycle(): void {
  // Flush the pending save when the popup is about to close. Firefox
  // MV3 may or may not fire these events; either way, the writes have
  // already been issued synchronously on each state change.
  window.addEventListener('beforeunload', () => {
    void flushPersist();
  });
  window.addEventListener('pagehide', () => {
    void flushPersist();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushPersist();
  });
}

function wireDiagnostics(): void {
  const btn = document.getElementById('diag-view') as HTMLButtonElement | null;
  const out = document.getElementById('diag-output') as HTMLDivElement | null;
  if (!btn || !out) return;
  btn.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (tab === null) {
      out.hidden = false;
      out.textContent = 'No hay pestaña activa.';
      out.dataset.state = 'error';
      return;
    }
    out.hidden = false;
    out.dataset.state = 'busy';
    out.textContent = 'Recopilando reporte seguro…';
    btn.disabled = true;
    try {
      const res = await sendToContent<SafeReportResult>(tab.id, {
        kind: 'collectDiagnostics',
        tabId: tab.id,
      });
      if (!res || res.kind !== 'safeReportResult' || !res.ok || !res.report) {
        throw new Error(res?.error ?? 'reporte no disponible');
      }
      out.dataset.state = 'ok';
      out.textContent = renderSafeReportText(res.report);
    } catch (err) {
      out.dataset.state = 'error';
      out.textContent = `Error: ${(err as Error).message}`;
    } finally {
      btn.disabled = false;
    }
  });
}

function renderSafeReportText(report: SafeReport): string {
  const top = report.recentCodes
    .slice(0, 5)
    .map((c: { code: string; stage: string; count: number }) => `${c.code} (${c.stage}) x${c.count}`)
    .join(', ');
  const truncatedNote = report.truncated
    ? ' Algunas entradas fueron descartadas por desbordamiento del anillo.'
    : '';
  return [
    `Esquema ${report.schemaVersion} — ${report.generator}@${report.generatorVersion}`,
    `Manifiesto MV${report.manifestVersion} — ${report.ring.length}/${report.ring.capacity} eventos${truncatedNote}`,
    `Total eventos: ${report.counts.events}`,
    top ? `Más frecuentes: ${top}` : 'Sin eventos aún.',
  ].join('\n');
}

function wire(): void {
  wireTabs();
  wireExtract();
  wireAutofill();
  wireDiagnostics();
  wirePersistenceLifecycle();
  setStatus('Pulsa "Extraer página actual" para detectar el cuestionario.', 'idle');
  // Hydrate silently. Failures (no tab, no storage, malformed payload)
  // are non-fatal — the popup just starts in the default idle state.
  void hydrate();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire, { once: true });
  } else {
    wire();
  }
}