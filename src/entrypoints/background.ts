// Background coordinator (MV3 service worker).
// Stub for PR #1. Real logic lives in subsequent PRs.
//
// Responsabilidades (futuras):
//  - PermissionManager (origen-allowlist, dynamic content scripts)
//  - PageFetchClient (GET autenticado, concurrency 1)
//  - AssetFetchClient (pluginfile.php, MIME allowlist, magic bytes)
//  - JobStore (storage.session, TTL 30 min, nunca storage.sync)
//  - DownloadService (downloads.download, revoca blob: tras uso)
//  - [futuro] NativeMessagingBridge

export default defineBackground(() => {
  // eslint-disable-next-line no-console
  console.log('[moodle-quiz-extractor] background started');
});
