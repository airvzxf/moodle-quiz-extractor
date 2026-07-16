import { defineConfig } from 'wxt';

// https://wxt.dev/api/config.html
// WXT 0.20.27's `srcDir` doubles as the root of the `~/*` alias (it cannot
// be overridden in `alias`). Setting `srcDir: './src'` makes `~` point at
// `src/`, where we keep both the library code and the WXT entrypoints.
export default defineConfig({
  srcDir: './src',
  outDir: '.output',
  manifest: () => ({
    name: 'Moodle Quiz Extractor',
    description:
      'Exporta cuestionarios de Moodle a Markdown local con imágenes y autollenado seguro.',
    permissions: ['activeTab', 'storage', 'scripting', 'downloads'],
    host_permissions: ['*://*/*mod/quiz/attempt.php*'],
    optional_host_permissions: ['<all_urls>'],
    incognito: 'not_allowed',
    browser_specific_settings: {
      gecko: {
        id: 'moodle-quiz-extractor@airvzxf.dev',
        strict_min_version: '140.0',
        data_collection_permissions: { required: ['none'] },
      },
      gecko_android: {
        id: 'moodle-quiz-extractor@airvzxf.dev',
        strict_min_version: '142.0',
      },
    },
  }),
});
