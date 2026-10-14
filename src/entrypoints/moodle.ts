// Script que el popup inyecta en la pestaña activa (scripting.executeScript).
// Sólo conecta el navegador con content/handler.ts; la lógica vive allí.
import { handleRequest, type ContentEnv } from '@/content/handler';
import type { MqxRequest } from '@/messaging/protocol';

// Firefox: `content.fetch` hace la petición como la propia página (mismo
// origen y cookies). Chrome no lo tiene: su fetch de content script ya actúa
// con el origen de la página.
declare const content: { fetch?: typeof fetch } | undefined;

const REQUEST_TYPES = new Set(['mqx:status', 'mqx:export', 'mqx:preview', 'mqx:apply']);

function isRequest(message: unknown): message is MqxRequest {
  return (
    typeof message === 'object' &&
    message !== null &&
    REQUEST_TYPES.has((message as { type?: unknown }).type as string)
  );
}

export default defineUnlistedScript(() => {
  const flag = globalThis as { __mqxInstalled?: boolean };
  if (flag.__mqxInstalled) return;
  flag.__mqxInstalled = true;

  const pageFetch: typeof fetch =
    typeof content !== 'undefined' && typeof content?.fetch === 'function'
      ? content.fetch.bind(content)
      : fetch.bind(globalThis);

  const env = (): ContentEnv => ({
    doc: document,
    url: location.href,
    loadPage: async (url) => {
      const response = await pageFetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return new DOMParser().parseFromString(await response.text(), 'text/html');
    },
    fetchImage: (url) => pageFetch(url, { credentials: 'include' }),
  });

  // Chrome sólo admite respuestas asíncronas con sendResponse + `return true`.
  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isRequest(message)) return false;
    handleRequest(message, env()).then(sendResponse, () => sendResponse(null));
    return true;
  });
});
