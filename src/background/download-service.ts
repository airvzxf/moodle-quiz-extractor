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
  blobs?: {
    createObjectURL?: (blob: Blob) => string;
  };
  urls?: {
    revokeObjectURL?: (url: string) => void;
  };
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

/** Construct a download service backed by `api` (defaults to `browser`). */
export function createDownloadService(api: DownloadApi = browser): DownloadService {
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
      const blobUrl =
        api.blobs?.createObjectURL?.(blob) ??
        // Fallback for service workers without `URL.createObjectURL`:
        // serialize the bytes to base64 data URL. Slower, but always works.
        bytesToDataUrl(bytes, 'application/zip');
      const id = await api.downloads.download({
        url: blobUrl,
        filename,
        saveAs: true,
      });
      // Revoke once the download reaches "complete". The listener is best
      // effort: if the browser never fires onChanged (e.g. user cancels),
      // we leak the blob URL until the service worker restarts.
      const onChanged = api.downloads.onChanged;
      const revoke = () => {
        api.urls?.revokeObjectURL?.(blobUrl);
      };
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

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  // base64 via chunked concat (works in any modern engine).
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const b64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(bytes).toString('base64');
  return `data:${mime};base64,${b64}`;
}

// `browser` global is provided by @types/firefox-webext-browser in the
// background service worker build; reference it here so the linter does
// not flag it as unused when the type-augmentation isn't loaded yet.
declare const browser: DownloadApi;