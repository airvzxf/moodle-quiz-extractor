// src/background/page-fetch-client.ts
//
// Authenticated GET of subsequent Moodle quiz pages. Used by the
// pagination controller (PR #20) to fetch each `?page=N` view without
// breaking the user's session.
//
// Design:
//  - concurrency = 1 (mutex). Moodle's CSRF/session cookies are
//    per-tab; parallel fetches can interleave and confuse `navigator.locks`.
//  - redirects to /login/ are detected early and surface as a structured
//    `MQX-PAGE-002` error instead of an opaque HTML body.
//  - The `originPattern` allowlist matches the page origin only (e.g.
//    `https://moodle.example.edu/*`). The asset fetcher (PR #2) uses the
//    same helper for pluginfile.php URLs.

import { MQX, type MqxCode } from '~/diagnostics/codes';
import { redactString } from '~/diagnostics/redactor';

export interface PageFetchOptions {
  /** Concurrency cap. Defaults to 1. */
  readonly concurrency?: number;
  /** Per-request timeout via AbortController. Defaults to 15 s. */
  readonly timeoutMs?: number;
  /** Origin allowlist regex (defaults to the literal page origin). */
  readonly originPattern?: string;
}

export interface PageFetchInput {
  readonly url: string;
  /** Optional Referer. Defaults to the URL minus the query string. */
  readonly referer?: string;
}

export interface PageFetchResult {
  readonly url: string;
  readonly finalUrl: string;
  readonly html: string;
  readonly status: number;
}

export interface PageFetchFailure {
  readonly url: string;
  readonly status: 'failed';
  readonly failureCode: MqxCode;
  readonly errorMessage: string;
}

export type PageFetchOutcome = PageFetchResult | PageFetchFailure;

export interface PageFetchClient {
  fetchOne(input: PageFetchInput): Promise<PageFetchOutcome>;
  fetchAll(inputs: ReadonlyArray<PageFetchInput>): Promise<ReadonlyArray<PageFetchOutcome>>;
}

const DEFAULT_OPTIONS: Required<PageFetchOptions> = {
  concurrency: 1,
  timeoutMs: 15_000,
  originPattern: '',
};

export function createPageFetchClient(
  fetchImpl: typeof fetch,
  options: PageFetchOptions = {},
): PageFetchClient {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let inFlight = 0;
  const waiters: Array<() => void> = [];

  async function acquire(): Promise<void> {
    if (inFlight < opts.concurrency) {
      inFlight += 1;
      return;
    }
    await new Promise<void>((resolve) => waiters.push(resolve));
    inFlight += 1;
  }

  function release(): void {
    inFlight -= 1;
    const next = waiters.shift();
    if (next) next();
  }

  async function fetchOne(input: PageFetchInput): Promise<PageFetchOutcome> {
    await acquire();
    try {
      return await doFetch(input);
    } finally {
      release();
    }
  }

  async function doFetch(input: PageFetchInput): Promise<PageFetchOutcome> {
    if (!urlMatchesOrigin(input.url, opts.originPattern)) {
      return {
        url: input.url,
        status: 'failed',
        failureCode: MQX.PAGE_LAYOUT_UNRECOGNIZED,
        errorMessage: `origin denied for ${input.url}`,
      };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const res = await fetchImpl(input.url, {
        credentials: 'include',
        redirect: 'follow',
        headers: input.referer ? { Referer: input.referer } : undefined,
        signal: controller.signal,
      });
      const finalUrl = res.url || input.url;
      if (/login|logintoken/i.test(finalUrl) && finalUrl !== input.url) {
        return {
          url: input.url,
          status: 'failed',
          failureCode: MQX.PAGE_NAVIGATION_SKIPPED,
          errorMessage: `redirected to ${finalUrl}`,
        };
      }
      if (!res.ok) {
        return {
          url: input.url,
          status: 'failed',
          failureCode: MQX.PAGE_LAYOUT_UNRECOGNIZED,
          errorMessage: `HTTP ${res.status} ${res.statusText}`,
        };
      }
      const html = await res.text();
      return {
        url: input.url,
        finalUrl,
        html: redactString(html),
        status: res.status,
      };
    } catch (err) {
      const isAbort = (err as { name?: string })?.name === 'AbortError';
      return {
        url: input.url,
        status: 'failed',
        failureCode: isAbort ? MQX.PAGE_LAYOUT_UNRECOGNIZED : MQX.PAGE_LAYOUT_UNRECOGNIZED,
        errorMessage: isAbort ? 'timeout' : (err as Error).message,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchAll(
    inputs: ReadonlyArray<PageFetchInput>,
  ): Promise<ReadonlyArray<PageFetchOutcome>> {
    const out: PageFetchOutcome[] = [];
    let cursor = 0;
    async function worker(): Promise<void> {
      while (cursor < inputs.length) {
        const i = cursor++;
        const input = inputs[i]!;
        out[i] = await fetchOne(input);
      }
    }
    const workers = Array.from(
      { length: Math.min(opts.concurrency, inputs.length || 1) },
      () => worker(),
    );
    await Promise.all(workers);
    return out;
  }

  return { fetchOne, fetchAll };
}

function urlMatchesOrigin(url: string, originPattern: string): boolean {
  if (!originPattern) return true;
  if (originPattern === '<all_urls>' || originPattern === '*://*/*') return true;
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