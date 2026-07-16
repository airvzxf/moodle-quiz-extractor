// src/popup/main.ts
//
// Popup entrypoint script. Wired from `src/entrypoints/popup.html`
// via `<script type="module" src="../../popup/main.ts">`. Kept out of
// `src/entrypoints/` so WXT 0.20.27 does not pick it up as a separate
// `unlisted-script` entrypoint (its glob matches every `*.ts` file
// inside `entrypoints/`).
//
// Communication contract:
//   1. detect   → { kind: 'extractQuiz' }                (content → here)
//   2. download → { kind: 'zipQuiz', document, tabUrl } (here → background)
//   3. result   → { kind: 'zipResult', ok, ... }         (background → here)
//   4. autofill → { kind: 'prepareAutofill', jobId, answersText } (here → content)
//   5. apply    → { kind: 'applyAutofill', jobId }       (here → content)
//   6. abort    → { kind: 'abortAutofill', jobId }       (here → content)

import type { QuizDocument } from '~/domain/quiz-schema';
import type {
  ApplyAutofillResult,
  GetAutofillJobResult,
  PrepareAutofillResult,
  QuizDocumentMessage,
  ZipResult,
} from '~/messaging/runtime-messages';

interface RuntimeApi {
  tabs?: {
    query: (
      q: { active: boolean; currentWindow: boolean },
    ) => Promise<Array<{ id?: number; url?: string }>>;
    sendMessage: (tabId: number, message: unknown) => Promise<unknown>;
  };
  runtime?: {
    sendMessage: (message: unknown) => Promise<unknown>;
    lastError?: { message?: string };
  };
}

const api: RuntimeApi = browser;

const state: {
  lastDocument: QuizDocument | null;
  lastJobId: string | null;
} = { lastDocument: null, lastJobId: null };

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
  const tabs = await api.tabs?.query({ active: true, currentWindow: true });
  const tab = tabs?.[0];
  if (!tab || typeof tab.id !== 'number') return null;
  return { id: tab.id, url: typeof tab.url === 'string' ? tab.url : undefined };
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
    setStatus(`Detectado: ${doc.title} — ${doc.questions.length} pregunta(s).`, 'ok');
    btnZip.disabled = false;
  });

  btnZip.addEventListener('click', async () => {
    if (!state.lastDocument) return;
    setStatus('Descargando ZIP…', 'busy');
    btnZip.disabled = true;
    try {
      // The popup captures the active tab URL itself and forwards it to
      // the background so the AssetFetcher can request a permission
      // scoped to the real Moodle origin (e.g.
      // `https://moodle.example.edu/*`). Without this, the background
      // falls back to `<all_urls>` (PR #15 fix).
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
        btnApply.disabled = true;
        btnCancel.disabled = true;
        return;
      }
      state.lastJobId = jobId;
      const warnMsg = (res.warnings ?? []).length > 0 ? ` (${res.warnings!.length} aviso(s))` : '';
      setStatus(`OK: ${res.stepCount ?? 0} pasos listos${warnMsg}. Pulsa "Aplicar respuestas" o "Cancelar".`, 'ok');
      btnApply.disabled = false;
      // Enable Cancel after a successful validation so the user can
      // back out before touching the DOM. The job sits in the content
      // script's in-memory map until either apply or abort clears it.
      btnCancel.disabled = false;
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
    // Cancel stays enabled during apply so the user can abort mid-loop.
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
      } else {
        setStatus(`Listo: ${res.applied}/${res.total} controles aplicados. Revisa y envía manualmente.`, 'ok');
      }
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`, 'error');
    } finally {
      btnCancel.disabled = true;
      void sendToContent<GetAutofillJobResult>(tid, {
        kind: 'getAutofillJob',
        jobId: state.lastJobId,
      });
    }
  });

  /**
   * Cancel button. Two cases:
   *  (a) before apply — the user has validated but changed their mind.
   *      We abort the in-memory job, clear the textarea, and return to
   *      idle. The QuizDocument detection (lastDocument) and the ZIP
   *      download button stay enabled — re-detection is unrelated.
   *  (b) during apply — abortAutofill is already in flight via the
   *      content script's per-step loop. Calling it again is a no-op
   *      (handleAbort is idempotent).
   */
  btnCancel.addEventListener('click', async () => {
    const tid = await tabId();
    if (tid === null) return;
    if (state.lastJobId) {
      await sendToContent(tid, { kind: 'abortAutofill', jobId: state.lastJobId });
      state.lastJobId = null;
    }
    input.value = '';
    btnApply.disabled = true;
    btnCancel.disabled = true;
    setStatus('Cancelado. Pega otra lista o pulsa "Extraer página actual" para reiniciar.', 'idle');
  });
}

function wire(): void {
  wireTabs();
  wireExtract();
  wireAutofill();
  setStatus('Pulsa "Extraer página actual" para detectar el cuestionario.', 'idle');
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire, { once: true });
  } else {
    wire();
  }
}