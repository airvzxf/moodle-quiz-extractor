// Popup: interfaz "tonta". Inyecta el script en la pestaña, le pide cosas por
// mensajes y dibuja las respuestas. Los textos vienen de shared/messages.ts.
import type { ReplyMap, MqxRequest } from '@/messaging/protocol';
import type { FillReply } from '@/messaging/protocol';
import { fromBase64 } from '@/shared/base64';
import {
  describeFailure,
  describeIssue,
  describeLineError,
  describeWarning,
} from '@/shared/messages';

type Tab = Browser.tabs.Tab;

const DOWNLOAD_WAIT_MS = 60_000;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} no existe en popup.html`);
  return node as T;
}

const ui = {
  status: el<HTMLParagraphElement>('status'),
  exportSection: el<HTMLElement>('export'),
  fillSection: el<HTMLElement>('fill'),
  detailed: el<HTMLInputElement>('detailed'),
  exportBtn: el<HTMLButtonElement>('export-btn'),
  exportResult: el<HTMLParagraphElement>('export-result'),
  exportWarnings: el<HTMLUListElement>('export-warnings'),
  answers: el<HTMLTextAreaElement>('answers'),
  previewBtn: el<HTMLButtonElement>('preview-btn'),
  applyBtn: el<HTMLButtonElement>('apply-btn'),
  fillResult: el<HTMLParagraphElement>('fill-result'),
  fillMessages: el<HTMLUListElement>('fill-messages'),
};

function setList(list: HTMLUListElement, items: string[]): void {
  list.replaceChildren(
    ...items.map((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      return li;
    }),
  );
}

// Sólo en compilaciones de prueba (WXT_SMOKE=1): la pestaña se elige por URL
// porque las pruebas abren el popup como una pestaña normal.
async function targetTab(): Promise<Tab | undefined> {
  if (import.meta.env.WXT_SMOKE === '1') {
    const target = new URLSearchParams(location.search).get('target');
    if (target) return (await browser.tabs.query({ url: target }))[0];
  }
  return (await browser.tabs.query({ active: true, currentWindow: true }))[0];
}

function send<T extends MqxRequest>(tabId: number, request: T): Promise<ReplyMap[T['type']]> {
  return browser.tabs.sendMessage(tabId, request) as Promise<ReplyMap[T['type']]>;
}

function answersKey(tab: Tab): string {
  const url = new URL(tab.url ?? 'about:blank');
  return `answers:${url.origin}:${url.searchParams.get('attempt') ?? ''}`;
}

async function download(fileName: string, zipBase64: string): Promise<void> {
  const blob = new Blob([fromBase64(zipBase64)], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  try {
    const id = await browser.downloads.download({
      url,
      filename: fileName,
      conflictAction: 'uniquify',
      saveAs: false,
    });
    // El blob debe seguir vivo hasta que la descarga termine.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, DOWNLOAD_WAIT_MS);
      function done(): void {
        clearTimeout(timer);
        browser.downloads.onChanged.removeListener(listener);
        resolve();
      }
      function listener(delta: { id: number; state?: { current?: string } }): void {
        if (delta.id === id && delta.state?.current && delta.state.current !== 'in_progress') done();
      }
      browser.downloads.onChanged.addListener(listener);
      // Un ZIP pequeño puede terminar antes de que exista el listener;
      // sin esta consulta se esperaría DOWNLOAD_WAIT_MS completo.
      void browser.downloads.search({ id }).then(
        ([item]) => {
          if (item && item.state !== 'in_progress') done();
        },
        () => {},
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function renderFill(reply: FillReply, applying: boolean): void {
  if (!reply.ok) {
    ui.fillResult.textContent = 'Esta pestaña ya no muestra un intento de cuestionario.';
    setList(ui.fillMessages, []);
    return;
  }
  const messages = [
    ...reply.parseErrors.map(describeLineError),
    ...reply.plan.issues.map(describeIssue),
    ...(reply.report?.failed.map(describeFailure) ?? []),
  ];
  if (applying && reply.report) {
    const applied = reply.report.applied;
    ui.fillResult.textContent =
      applied.length > 0
        ? `Aplicadas en esta página: ${applied.join(', ')}.`
        : 'No se aplicó ninguna respuesta en esta página.';
  } else {
    const numbers = reply.plan.steps.map((s) => s.number);
    ui.fillResult.textContent =
      numbers.length > 0
        ? `Se pueden aplicar en esta página: ${numbers.join(', ')}.`
        : 'Ninguna respuesta se puede aplicar en esta página.';
  }
  setList(ui.fillMessages, messages);
}

async function main(): Promise<void> {
  const tab = await targetTab();
  const tabId = tab?.id;
  if (tab === undefined || tabId === undefined) {
    ui.status.textContent = 'No hay una pestaña activa.';
    return;
  }
  try {
    await browser.scripting.executeScript({ target: { tabId }, files: ['/moodle.js'] });
  } catch {
    ui.status.textContent =
      'Abre un intento de cuestionario de Moodle (…/mod/quiz/attempt.php) y vuelve a pulsar el icono.';
    return;
  }

  const status = await send(tabId, { type: 'mqx:status' });
  if (status.kind === 'login') {
    ui.status.textContent = 'Tu sesión de Moodle caducó. Inicia sesión y vuelve a abrir el intento.';
    return;
  }
  if (status.kind === 'not-attempt') {
    ui.status.textContent =
      'Esta pestaña no es un intento de cuestionario de Moodle (…/mod/quiz/attempt.php).';
    return;
  }

  const paging =
    status.pages.length > 1
      ? `Página ${status.currentPage + 1} de ${status.pages.length}`
      : 'Una sola página';
  const sequential =
    status.mode === 'sequential' && status.pages.length > 1
      ? ' · navegación secuencial: sólo se exporta esta página'
      : '';
  ui.status.textContent = `${status.title} — ${paging} · ${status.onPage.length} de ${status.total} preguntas aquí${sequential}`;
  ui.exportSection.hidden = false;
  ui.fillSection.hidden = false;

  const key = answersKey(tab);
  const saved = await browser.storage.session.get(key);
  if (typeof saved[key] === 'string') ui.answers.value = saved[key];
  ui.answers.addEventListener('input', () => {
    void browser.storage.session.set({ [key]: ui.answers.value });
  });

  ui.exportBtn.addEventListener('click', async () => {
    ui.exportBtn.disabled = true;
    ui.exportResult.textContent = 'Exportando…';
    setList(ui.exportWarnings, []);
    try {
      const reply = await send(tabId, {
        type: 'mqx:export',
        detailed: ui.detailed.checked,
        generatorVersion: browser.runtime.getManifest().version,
        exportedAt: new Date().toISOString(),
      });
      if (!reply.ok) {
        ui.exportResult.textContent =
          reply.error === 'login'
            ? 'Tu sesión de Moodle caducó.'
            : 'No se pudo exportar el cuestionario.';
        return;
      }
      await download(reply.fileName, reply.zipBase64);
      ui.exportResult.textContent = `Listo: ${reply.questions} preguntas en ${reply.fileName}.`;
      setList(ui.exportWarnings, reply.warnings.map(describeWarning));
    } catch {
      ui.exportResult.textContent = 'No se pudo exportar el cuestionario.';
    } finally {
      ui.exportBtn.disabled = false;
    }
  });

  const fill = async (applying: boolean): Promise<void> => {
    ui.previewBtn.disabled = true;
    ui.applyBtn.disabled = true;
    try {
      const answers = ui.answers.value;
      await browser.storage.session.set({ [key]: answers });
      const reply = await send(tabId, applying ? { type: 'mqx:apply', answers } : { type: 'mqx:preview', answers });
      renderFill(reply, applying);
    } catch {
      ui.fillResult.textContent = 'No se pudo comunicar con la pestaña. Recarga la página y vuelve a intentarlo.';
    } finally {
      ui.previewBtn.disabled = false;
      ui.applyBtn.disabled = false;
    }
  };
  ui.previewBtn.addEventListener('click', () => void fill(false));
  ui.applyBtn.addEventListener('click', () => void fill(true));
}

void main();
