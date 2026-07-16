// src/background/asset-fetch-client.ts
//
// Authenticated HTTP GET for `pluginfile.php` assets. Runs in the MV3
// service worker. Uses `fetch` with `credentials: 'include'` so the existing
// Moodle session cookie is sent without requesting the `cookies` permission.
//
// Validation pipeline:
//   1. Origin is in the per-call allowlist (caller decides; never falls
//      back to <all_urls>).
//   2. Response status 200. 3xx redirects to a login page -> MQX-ASSET-204.
//   3. Content-Type header matches the allowlist.
//   4. Content-Length header ≤ maxBytes (default 10 MiB).
//   5. Body bytes pass `validateMagicBytes` for the declared MIME.
//
// All errors return `FetchedAsset { status: 'failed', failureCode }` so the
// orchestrator can keep going instead of aborting the whole pipeline.

import {
  ASSET_MIME_ALLOWLIST,
  type AllowedMime,
  sha256,
  validateMagicBytes,
} from '~/export/asset-planner';
import type { AssetEntry } from '~/export/asset-planner';
import { MQX, type MqxCode } from '~/diagnostics/codes';

export interface FetchedAsset {
  readonly entry: AssetEntry;
  readonly bytes?: Uint8Array;
  readonly mime?: AllowedMime;
  readonly status: 'downloaded' | 'failed' | 'skipped';
  readonly failureCode?: MqxCode;
  readonly errorMessage?: string;
}

export interface FetchAssetOptions {
  /** Hard cap on the response size. Defaults to 10 MiB. */
  readonly maxBytes?: number;
  /** Per-request timeout via AbortController. Defaults to 10s. */
  readonly timeoutMs?: number;
  /** Concurrency cap. Defaults to 4 parallel fetches. */
  readonly concurrency?: number;
}

export interface AssetFetcher {
  /** Fetch a single asset. Always resolves; failures populate failureCode. */
  fetchOne: (entry: AssetEntry) => Promise<FetchedAsset>;
  /** Fetch all assets in `entries` with bounded concurrency. */
  fetchAll: (entries: ReadonlyArray<AssetEntry>) => Promise<FetchedAsset[]>;
}

const DEFAULT_OPTIONS: Required<FetchAssetOptions> = {
  maxBytes: 10 * 1024 * 1024,
  timeoutMs: 10_000,
  concurrency: 4,
};

/** Create an `AssetFetcher` backed by a user-supplied `fetch` function. The
 *  indirection lets tests inject a stub without monkey-patching globals. */
export function createAssetFetcher(
  originPattern: string,
  fetchImpl: typeof fetch,
  options: FetchAssetOptions = {},
): AssetFetcher {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const allowedMimes = new Set<string>(ASSET_MIME_ALLOWLIST);

  async function fetchOne(entry: AssetEntry): Promise<FetchedAsset> {
    if (!urlMatchesOrigin(entry.sourceUrl, originPattern)) {
      return {
        entry,
        status: 'failed',
        failureCode: MQX.ASSET_MIME_DENIED,
        errorMessage: `origin denied for ${entry.sourceUrl}`,
      };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const res = await fetchImpl(entry.sourceUrl, {
        credentials: 'include',
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!res.ok) {
        return {
          entry,
          status: 'failed',
          failureCode: MQX.ASSET_NETWORK,
          errorMessage: `HTTP ${res.status} ${res.statusText}`,
        };
      }
      // Moodle's `pluginfile.php` redirects to the login page when the
      // session cookie is missing or expired. Detect it early.
      const finalUrl = res.url || entry.sourceUrl;
      if (/login|logintoken/i.test(finalUrl) && finalUrl !== entry.sourceUrl) {
        return {
          entry,
          status: 'failed',
          failureCode: MQX.ASSET_REDIRECT_LOGIN,
          errorMessage: `redirected to ${finalUrl}`,
        };
      }
      const declaredType = (res.headers.get('content-type') ?? '')
        .toLowerCase()
        .split(';')[0]
        ?.trim();
      if (!declaredType || !allowedMimes.has(declaredType)) {
        return {
          entry,
          status: 'failed',
          failureCode: MQX.ASSET_MIME_DENIED,
          errorMessage: `Content-Type ${declaredType ?? '<missing>'}`,
        };
      }
      const lengthRaw = res.headers.get('content-length');
      if (lengthRaw) {
        const length = Number.parseInt(lengthRaw, 10);
        if (Number.isFinite(length) && length > opts.maxBytes) {
          return {
            entry,
            status: 'failed',
            failureCode: MQX.ASSET_TOO_LARGE,
            errorMessage: `Content-Length ${length} > ${opts.maxBytes}`,
          };
        }
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > opts.maxBytes) {
        return {
          entry,
          status: 'failed',
          failureCode: MQX.ASSET_TOO_LARGE,
          errorMessage: `body ${bytes.byteLength} > ${opts.maxBytes}`,
        };
      }
      const magic = validateMagicBytes(bytes, declaredType);
      if (!magic.ok) {
        return {
          entry,
          status: 'failed',
          failureCode: MQX.ASSET_MIME_DENIED,
          errorMessage: `magic bytes mismatch (${magic.got})`,
        };
      }
      const hash = await sha256(bytes);
      return {
        entry: {
          ...entry,
          sha256: hash,
          bytes,
          mime: declaredType,
          status: 'downloaded',
        },
        bytes,
        mime: declaredType as AllowedMime,
        status: 'downloaded',
      };
    } catch (err) {
      const isAbort = (err as { name?: string })?.name === 'AbortError';
      return {
        entry,
        status: 'failed',
        failureCode: isAbort ? MQX.ASSET_NETWORK : MQX.ASSET_NETWORK,
        errorMessage: isAbort ? 'timeout' : (err as Error).message,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchAll(
    entries: ReadonlyArray<AssetEntry>,
  ): Promise<FetchedAsset[]> {
    const out: FetchedAsset[] = new Array(entries.length);
    let cursor = 0;
    async function worker(): Promise<void> {
      while (cursor < entries.length) {
        const i = cursor++;
        const entry = entries[i]!;
        out[i] = await fetchOne(entry);
      }
    }
    const workers = Array.from(
      { length: Math.min(opts.concurrency, entries.length || 1) },
      () => worker(),
    );
    await Promise.all(workers);
    return out;
  }

  return { fetchOne, fetchAll };
}

function urlMatchesOrigin(url: string, originPattern: string): boolean {
  if (!originPattern) return false;
  // The runtime origin pattern looks like `*://*/*pluginfile.php*`. We
  // don't try to compile this to a real URL matcher — instead we check
  // the simple cases:
  //  - "*://*/*" — allow every URL (used by tests + the opt-in grant path)
  //  - "<scheme>://<host>/*" — match by protocol+host
  //  - any other pattern — fall back to substring match after dropping `*`
  if (originPattern === '*://*/*' || originPattern === '<all_urls>') {
    return true;
  }
  try {
    const u = new URL(url);
    const m = originPattern.match(/^(\*|https?|\*?):\/\/(\*|[^*/]+)\//);
    if (m) {
      const schemeOk = m[1] === '*' || m[1] === u.protocol.slice(0, -1);
      const hostOk = m[2] === '*' || m[2] === u.host;
      return Boolean(schemeOk && hostOk);
    }
  } catch {
    /* fall through */
  }
  const stripped = originPattern.replace(/\*/g, '');
  return url.startsWith(stripped);
}