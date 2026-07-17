import { defineConfig } from 'wxt';

// https://wxt.dev/api/config.html
// WXT 0.20.27's `srcDir` doubles as the root of the `~/*` alias (it cannot
// be overridden in `alias`). Setting `srcDir: './src'` makes `~` point at
// `src/`, where we keep both the library code and the WXT entrypoints.
export default defineConfig({
  srcDir: './src',
  outDir: '.output',
  // The source ZIP must NOT contain the developer's raw HTML fixtures
  // (resources/) which carry real sesskey / MoodleSession values. The
  // `tests/fixtures/redacted/` copies are git-tracked and safe; we
  // exclude only the unredacted source.
  zip: {
    excludeSources: [
      'resources',
      'resources/**',
      'coverage',
      '**/*.map',
      'debug-bundles',
    ],
  },
  manifest: () => ({
    name: 'Moodle Quiz Extractor',
    description:
      'Exporta cuestionarios de Moodle a Markdown local con imágenes y autollenado seguro.',
    icons: {
      '16': 'icon/16.png',
      '32': 'icon/32.png',
      '48': 'icon/48.png',
      '64': 'icon/64.png',
      '128': 'icon/128.png',
    },
    action: {
      default_title: 'Moodle Quiz Extractor',
      default_popup: 'popup.html',
      default_icon: {
        '16': 'icon/16.png',
        '32': 'icon/32.png',
        '48': 'icon/48.png',
      },
    },
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
        strict_min_version: '142.0',
      },
    },
  }),
});
