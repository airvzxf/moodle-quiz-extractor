// src/popup/main.ts
//
// Popup entrypoint script. Wired from `src/entrypoints/popup.html`
// via `<script type="module" src="../../popup/main.ts">`. Kept out of
// `src/entrypoints/` so WXT 0.20.27 does not pick it up as a separate
// `unlisted-script` entrypoint (its glob matches every `*.ts` file
// inside `entrypoints/`).
//
// Communication contract:
//   1. detect  → { kind: 'extractQuiz' }               (content → here)
//   2. download → { kind: 'zipQuiz', document }        (here → background)
//   3. result   → { kind: 'zipResult', ok, ... }        (background → here)

import type { QuizDocument } from '~/domain/quiz-schema';
import type {
  QuizDocumentMessage,
  ZipResult,
} from '~/messaging/runtime-messages';

interface RuntimeApi {
  tabs?: {
    query: (
      q: { active: boolean; currentWindow: boolean },
    ) => Promise<Array<{ id?: number }>>;
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

const state: { lastDocument: QuizDocument | null } = { lastDocument: null };

function setStatus(text: string, st: 'idle' | 'busy' | 'ok' | 'error'): void {
  const status = document.getElementById('status');
  if (!status) return;
  status.textContent = text;
  status.dataset.state = st;
}

async function getActiveTab(): Promise<number | null> {
  const tabs = await api.tabs?.query({ active: true, currentWindow: true });
  const id = tabs?.[0]?.id;
  return typeof id === 'number' ? id : null;
}

async function askContentForDocument(
  tabId: number,
): Promise<QuizDocument | null> {
  const reply = (await api.tabs?.sendMessage(tabId, {
    kind: 'extractQuiz',
  })) as QuizDocumentMessage | undefined;
  if (!reply || reply.kind !== 'quizDocument' || !reply.document) {
    setStatus(
      'Esta pestaña no parece un intento de cuestionario Moodle.',
      'error',
    );
    return null;
  }
  return reply.document as QuizDocument;
}

function wire(): void {
  const btnExtract = document.getElementById(
    'extract-current',
  ) as HTMLButtonElement | null;
  const btnZip = document.getElementById(
    'download-zip',
  ) as HTMLButtonElement | null;
  if (!btnExtract || !btnZip) return;

  btnExtract.addEventListener('click', async () => {
    setStatus('Extrayendo…', 'busy');
    const tabId = await getActiveTab();
    if (tabId === null) {
      setStatus('No hay pestaña activa.', 'error');
      return;
    }
    const doc = await askContentForDocument(tabId);
    if (!doc) return;
    state.lastDocument = doc;
    setStatus(
      `Detectado: ${doc.title} — ${doc.questions.length} pregunta(s).`,
      'ok',
    );
    btnZip.disabled = false;
  });

  btnZip.addEventListener('click', async () => {
    if (!state.lastDocument) return;
    setStatus('Descargando ZIP…', 'busy');
    btnZip.disabled = true;
    try {
      const result = (await api.runtime?.sendMessage({
        kind: 'zipQuiz',
        document: state.lastDocument,
      })) as ZipResult | undefined;
      if (!result || result.kind !== 'zipResult') {
        throw new Error('respuesta inválida del background');
      }
      if (!result.ok) {
        setStatus(`Error: ${result.error ?? 'desconocido'}`, 'error');
        return;
      }
      const counts = result.counts ?? {
        assetsDownloaded: 0,
        assetsFailed: 0,
        assetsTotal: 0,
      };
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

  setStatus(
    'Pulsa "Extraer página actual" para detectar el cuestionario.',
    'idle',
  );
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire, { once: true });
  } else {
    wire();
  }
}