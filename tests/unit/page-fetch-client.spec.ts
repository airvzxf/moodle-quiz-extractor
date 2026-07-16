// tests/unit/page-fetch-client.spec.ts

import { describe, it, expect, vi } from 'vitest';
import { createPageFetchClient } from '~/background/page-fetch-client';

type FetchCall = [unknown, RequestInit | undefined];

function makeResponse(body: string, init: { status?: number; statusText?: string; finalUrl: string }): Response {
  // The W3C Response constructor in Node's lib.dom doesn't accept `url`
  // in its init; jsdom and undici do. We set `url` post-construction
  // via Object.defineProperty to keep TS happy.
  const res = new Response(body, { status: init.status ?? 200, statusText: init.statusText });
  Object.defineProperty(res, 'url', { value: init.finalUrl, configurable: true });
  return res;
}

describe('page-fetch-client — happy path', () => {
  it('returns html and finalUrl on a 200 response', async () => {
    const html = '<!doctype html><html><body>page 2</body></html>';
    const fetchImpl = vi.fn<(input: unknown, init?: RequestInit) => Promise<Response>>(async () =>
      makeResponse(html, { status: 200, finalUrl: 'https://m.example.edu/mod/quiz/attempt.php?page=2' }),
    );
    const client = createPageFetchClient(fetchImpl as unknown as typeof fetch, {
      originPattern: 'https://m.example.edu/*',
    });
    const r = await client.fetchOne({ url: 'https://m.example.edu/mod/quiz/attempt.php?page=2' });
    expect(r.status).toBe(200);
    if (r.status !== 200) return;
    expect(r.html).toBe(html);
    expect(r.finalUrl).toContain('page=2');
  });

  it('passes credentials include and the referer header', async () => {
    const fetchImpl = vi.fn<(input: unknown, init?: RequestInit) => Promise<Response>>(async () =>
      makeResponse('ok', { status: 200, finalUrl: 'https://m.example.edu/' }),
    );
    const client = createPageFetchClient(fetchImpl as unknown as typeof fetch);
    await client.fetchOne({
      url: 'https://m.example.edu/mod/quiz/attempt.php?page=2',
      referer: 'https://m.example.edu/mod/quiz/attempt.php?page=1',
    });
    const call = fetchImpl.mock.calls[0] as FetchCall;
    expect(call[1]?.credentials).toBe('include');
    const headers = call[1]?.headers as Record<string, string> | undefined;
    expect(headers?.Referer).toBe('https://m.example.edu/mod/quiz/attempt.php?page=1');
  });
});

describe('page-fetch-client — error paths', () => {
  it('returns MQX-PAGE-006 when the response redirects to /login/', async () => {
    const fetchImpl = vi.fn<() => Promise<Response>>(async () =>
      makeResponse('login form', { status: 200, finalUrl: 'https://m.example.edu/login/index.php' }),
    );
    const client = createPageFetchClient(fetchImpl as unknown as typeof fetch, { originPattern: 'https://m.example.edu/*' });
    const r = await client.fetchOne({ url: 'https://m.example.edu/mod/quiz/attempt.php?page=2' });
    expect(r.status).toBe('failed');
    if (r.status !== 'failed') return;
    expect(r.failureCode).toBe('MQX-PAGE-006');
  });

  it('returns MQX-PAGE-005 on non-2xx HTTP', async () => {
    const fetchImpl = vi.fn<() => Promise<Response>>(async () =>
      makeResponse('not found', { status: 404, statusText: 'Not Found', finalUrl: 'https://m.example.edu/x' }),
    );
    const client = createPageFetchClient(fetchImpl as unknown as typeof fetch);
    const r = await client.fetchOne({ url: 'https://m.example.edu/x' });
    expect(r.status).toBe('failed');
    if (r.status !== 'failed') return;
    expect(r.failureCode).toBe('MQX-PAGE-005');
  });

  it('returns MQX-PAGE-005 when the URL is outside the origin pattern', async () => {
    const fetchImpl = vi.fn<() => Promise<Response>>(async () =>
      makeResponse('ok', { finalUrl: 'https://other.example.org/x' }),
    );
    const client = createPageFetchClient(fetchImpl as unknown as typeof fetch, { originPattern: 'https://m.example.edu/*' });
    const r = await client.fetchOne({ url: 'https://other.example.org/x' });
    expect(r.status).toBe('failed');
    if (r.status !== 'failed') return;
    expect(r.failureCode).toBe('MQX-PAGE-005');
  });

  it('aborts and reports timeout', async () => {
    const fetchImpl = vi.fn<(input: unknown, init?: RequestInit) => Promise<Response>>(async (_input, init) => {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const e = new Error('aborted');
          (e as Error & { name?: string }).name = 'AbortError';
          reject(e);
        });
      });
    });
    const client = createPageFetchClient(fetchImpl as unknown as typeof fetch, { timeoutMs: 5 });
    const r = await client.fetchOne({ url: 'https://m.example.edu/x' });
    expect(r.status).toBe('failed');
  });
});

describe('page-fetch-client — concurrency', () => {
  it('serializes fetches when concurrency=1', async () => {
    let active = 0;
    let maxActive = 0;
    const fetchImpl = vi.fn<() => Promise<Response>>(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return makeResponse('ok', { finalUrl: 'https://m.example.edu/x' });
    });
    const client = createPageFetchClient(fetchImpl as unknown as typeof fetch, { concurrency: 1 });
    await client.fetchAll([
      { url: 'https://m.example.edu/x' },
      { url: 'https://m.example.edu/x' },
      { url: 'https://m.example.edu/x' },
    ]);
    expect(maxActive).toBe(1);
  });

  it('honours concurrency > 1 when configured', async () => {
    let active = 0;
    let maxActive = 0;
    const fetchImpl = vi.fn<() => Promise<Response>>(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return makeResponse('ok', { finalUrl: 'https://m.example.edu/x' });
    });
    const client = createPageFetchClient(fetchImpl as unknown as typeof fetch, { concurrency: 3 });
    await client.fetchAll([
      { url: 'https://m.example.edu/x' },
      { url: 'https://m.example.edu/x' },
      { url: 'https://m.example.edu/x' },
    ]);
    expect(maxActive).toBe(3);
  });
});