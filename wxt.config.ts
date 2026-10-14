import { defineConfig } from 'wxt';

// Permisos mínimos: la extensión sólo actúa sobre la pestaña activa cuando la
// persona pulsa el icono (activeTab). No hay host_permissions ni <all_urls>.
export const MANIFEST_PERMISSIONS = ['activeTab', 'scripting', 'storage', 'downloads'];

// WXT_SMOKE=1 sólo para las pruebas de humo: el popup se abre como pestaña y no
// recibe activeTab, así que se concede el servidor local de pruebas.
const smoke = process.env.WXT_SMOKE === '1';

export default defineConfig({
  srcDir: 'src',
  outDir: smoke ? '.output-smoke' : '.output',
  manifest: {
    name: 'Moodle Quiz Extractor',
    description:
      'Exporta cuestionarios de Moodle a Markdown, JSON e imágenes, y autollena respuestas sin enviar el intento.',
    permissions: MANIFEST_PERMISSIONS,
    ...(smoke
      ? {
          host_permissions: ['http://127.0.0.1/*'],
          // Firefox (BiDi) no deja navegar a moz-extension://; la prueba abre
          // el popup desde la página falsa con window.open.
          web_accessible_resources: [{ resources: ['popup.html'], matches: ['http://127.0.0.1/*'] }],
        }
      : {}),
    action: { default_title: 'Moodle Quiz Extractor' },
    browser_specific_settings: {
      gecko: {
        id: 'moodle-quiz-extractor@airvzxf.dev',
        strict_min_version: '140.0',
        data_collection_permissions: { required: ['none'] },
      },
      gecko_android: { strict_min_version: '142.0' },
    },
  },
});
