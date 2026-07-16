// src/background/download-service.ts
//
// Triggers `browser.downloads.download` with a `Blob` payload and revokes
// the temporary `blob:` URL once the download reaches the `complete` state
// (or after a short timeout, in case the change listener never fires).
//
// The service is intentionally tiny — the heavy lifting lives in
// `ZipOrchestrator`. By isolating download concerns here we can mock this
// module from tests without touching the orchestrator.

export interface DownloadApi {
  downloads?: {
    download: (
      opts: { url: string; filename: string; saveAs?: boolean },
    ) => Promise<number>;
    onChanged?: {
      addListener: (
        cb: (delta: { id: number; state?: { current?: string } }) => void,
      ) => void;
    };
  };
  /**
   * Factory used to create the `blob:` URL handed to
   * `browser.downloads.download`. Firefox MV3 service workers do not
   * expose `browser.blobs`, but the global `URL.createObjectURL` static
   * is available (Firefox 121+). Tests inject a stub here so the
   * download service does not depend on a real Blob/URL pair.
   */
  createBlobUrl?: (blob: Blob) => string;
  /**
   * Revocation hook. Same rationale as `createBlobUrl`: real callers
   * use `URL.revokeObjectURL`, tests use a stub.
   */
  revokeBlobUrl?: (url: string) => void;
}

export interface DownloadResult {
  readonly id: number | null;
  readonly filename: string;
  readonly blobUrl: string;
}

export interface DownloadService {
  downloadZip: (
    bytes: Uint8Array,
    filename: string,
  ) => Promise<DownloadResult>;
}

/** Default factory: the global static `URL.createObjectURL`. Available in
 *  window, dedicated worker, and Firefox MV3 service-worker scopes since
 *  Firefox 121. We require it explicitly so a missing implementation
 *  surfaces as a clear error instead of a silent fallback to a
 *  `data:` URL (which Firefox MV3 rejects in `downloads.download`). */
const defaultCreateBlobUrl = (blob: Blob): string => {
  if (typeof URL.createObjectURL !== 'function') {
    throw new Error(
      'URL.createObjectURL is not available in this context; cannot produce a blob: URL for browser.downloads.download',
    );
  }
  return URL.createObjectURL(blob);
};

const defaultRevokeBlobUrl = (url: string): void => {
  if (typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(url);
  }
};

/** Construct a download service backed by `api` (defaults to `browser`). */
export function createDownloadService(
  api: DownloadApi = browser,
): DownloadService {
  const createBlobUrl = api.createBlobUrl ?? defaultCreateBlobUrl;
  const revokeBlobUrl = api.revokeBlobUrl ?? defaultRevokeBlobUrl;
  return {
    async downloadZip(bytes, filename) {
      if (!api.downloads?.download) {
        throw new Error('browser.downloads API unavailable in this context');
      }
      // The Blob constructor is available in both window and service worker
      // scopes; we type-cast to `any` so the service-worker build also
      // compiles without DOM lib augmentation.
      const blob = new Blob([bytes as unknown as ArrayBuffer], {
        type: 'application/zip',
      });
      const blobUrl = createBlobUrl(blob);
      if (!blobUrl.startsWith('blob:')) {
        // Firefox MV3's `downloads.download` rejects `data:`, `http:`, etc.
        // We refuse anything that isn't a `blob:` URL early to fail loudly
        // rather than surface the cryptic API error.
        revokeBlobUrl(blobUrl);
        throw new Error(
          `DownloadService produced a non-blob URL (${blobUrl.slice(0, 16)}…); ` +
            'browser.downloads.download in Firefox MV3 only accepts blob:/moz-extension: URLs',
        );
      }
      const id = await api.downloads.download({
        url: blobUrl,
        filename,
        saveAs: true,
      });
      // Revoke once the download reaches "complete". The listener is best
      // effort: if the browser never fires onChanged (e.g. user cancels),
      // we leak the blob URL until the service worker restarts.
      const onChanged = api.downloads.onChanged;
      const revoke = () => revokeBlobUrl(blobUrl);
      if (onChanged?.addListener) {
        onChanged.addListener((delta) => {
          if (delta.id === id && delta.state?.current === 'complete') revoke();
        });
      }
      // Belt + suspenders: schedule a revocation in 60s regardless.
      setTimeout(revoke, 60_000);
      return { id, filename, blobUrl };
    },
  };
}

// `browser` global is provided by @types/firefox-webext-browser in the
// background service worker build; reference it here so the linter does
// not flag it as unused when the type-augmentation isn't loaded yet.
declare const browser: DownloadApi;