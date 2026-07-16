// tests/unit/download-service.spec.ts
import { describe, it, expect } from 'vitest';
import { createDownloadService, type DownloadApi } from '~/background/download-service';

function fakeApi(opts?: {
  urlFactory?: (blob: Blob) => string;
  downloadReject?: boolean;
}): DownloadApi & { calls: { url: string; filename: string; saveAs?: boolean }[] } {
  const calls: { url: string; filename: string; saveAs?: boolean }[] = [];
  const api: DownloadApi & {
    calls: { url: string; filename: string; saveAs?: boolean }[];
  } = {
    calls,
    createBlobUrl:
      opts?.urlFactory ??
      (() => 'blob:https://example.invalid/00000000-0000-0000-0000-000000000000'),
    revokeBlobUrl: () => {},
    downloads: {
      download: (o) => {
        calls.push(o);
        if (opts?.downloadReject) {
          return Promise.reject(new Error('Access denied for URL data:...'));
        }
        return Promise.resolve(42);
      },
      onChanged: {
        addListener: () => {},
      },
    },
  };
  return api;
}

describe('DownloadService', () => {
  it('hands a blob: URL to browser.downloads.download (NOT data:)', async () => {
    const api = fakeApi();
    const svc = createDownloadService(api);
    const out = await svc.downloadZip(
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      'quiz.zip',
    );
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]?.url).toMatch(/^blob:/);
    expect(api.calls[0]?.url).not.toMatch(/^data:/);
    expect(api.calls[0]?.filename).toBe('quiz.zip');
    expect(api.calls[0]?.saveAs).toBe(true);
    expect(out.blobUrl).toMatch(/^blob:/);
    expect(out.id).toBe(42);
  });

  it('throws immediately if a factory returns a non-blob URL', async () => {
    const api = fakeApi({ urlFactory: () => 'data:application/zip;base64,AAA' });
    const svc = createDownloadService(api);
    await expect(svc.downloadZip(new Uint8Array([1, 2, 3]), 'q.zip')).rejects.toThrow(
      /non-blob URL/,
    );
    // We must NOT have handed the data: URL to downloads.download.
    expect(api.calls).toHaveLength(0);
  });

  it('propagates the underlying downloads.download error when the API rejects', async () => {
    const api = fakeApi({ downloadReject: true });
    const svc = createDownloadService(api);
    await expect(svc.downloadZip(new Uint8Array([1]), 'q.zip')).rejects.toThrow(
      /Access denied for URL data:/,
    );
  });

  it('throws when browser.downloads is unavailable', async () => {
    const api: DownloadApi = {
      createBlobUrl: () => 'blob:x',
      revokeBlobUrl: () => {},
    };
    const svc = createDownloadService(api);
    await expect(svc.downloadZip(new Uint8Array([1]), 'q.zip')).rejects.toThrow(
      /downloads API unavailable/,
    );
  });

  it('throws when URL.createObjectURL is missing in the runtime (no silent data: fallback)', async () => {
    // We simulate the very-old-engine case by temporarily removing the
    // global URL.createObjectURL and providing an api WITHOUT createBlobUrl
    // (so the default factory is invoked). downloads.download is provided
    // so we reach the URL.createObjectURL check rather than failing earlier
    // on the API-availability check.
    const originalCreate = (URL as { createObjectURL?: unknown }).createObjectURL;
    try {
      (URL as { createObjectURL?: unknown }).createObjectURL = undefined;
      const api: DownloadApi = {
        downloads: {
          download: () => Promise.resolve(0),
          onChanged: { addListener: () => {} },
        },
      }; // no createBlobUrl → uses default
      const svc = createDownloadService(api);
      await expect(svc.downloadZip(new Uint8Array([1]), 'q.zip')).rejects.toThrow(
        /URL\.createObjectURL is not available/,
      );
    } finally {
      (URL as { createObjectURL?: unknown }).createObjectURL = originalCreate;
    }
  });
});