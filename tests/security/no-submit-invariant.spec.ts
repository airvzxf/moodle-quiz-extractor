// tests/security/no-submit-invariant.spec.ts
//
// Merge-gate test for the no-submit invariant: both the form-spy and
// the fetch-spy must reject the patterns that would otherwise submit
// the attempt. We exercise them against the 4 redacted fixtures.

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { installNoSubmitSpy } from '~/moodle/applicators/no-submit-spy';
import { installFetchSpy } from '~/moodle/applicators/fetch-spy';

const FIXTURES = [
  'tests/fixtures/redacted/ddoo-01-page-01.html',
  'tests/fixtures/redacted/ddoo-02-page-01.html',
  'tests/fixtures/redacted/dsop-01-page-01.html',
  'tests/fixtures/redacted/dsop-02-page-01.html',
];

async function loadFixture(path: string): Promise<Document> {
  const html = await readFile(path, 'utf8');
  const { window } = new JSDOM(html, {
    url: 'https://ejemplo.mx/mod/quiz/attempt.php?attempt=__REDACTED__&cmid=__REDACTED__',
  });
  return window.document;
}

describe('no-submit invariant — all 4 redacted fixtures', () => {
  it.each(FIXTURES)(
    '%s: form.submit() throws MQX-FILL-304',
    async (path) => {
      const document = await loadFixture(path);
      const form = document.getElementById('responseform') as HTMLFormElement;
      expect(form).not.toBeNull();
      const spy = installNoSubmitSpy(document);
      try {
        expect(() => form.submit()).toThrowError(/MQX-FILL-304/);
        expect(spy.blocked()).toBeGreaterThanOrEqual(1);
      } finally {
        spy.uninstall();
      }
    },
  );

  it.each(FIXTURES)(
    '%s: form.requestSubmit() throws MQX-FILL-304',
    async (path) => {
      const document = await loadFixture(path);
      const form = document.getElementById('responseform') as HTMLFormElement;
      const spy = installNoSubmitSpy(document);
      try {
        expect(() => form.requestSubmit()).toThrowError(/MQX-FILL-304/);
      } finally {
        spy.uninstall();
      }
    },
  );
});

describe('fetch-spy invariant — pattern coverage', () => {
  it('blocks POST to /mod/quiz/attempt.php?finishattempt=1', async () => {
    const calls: unknown[] = [];
    const fetchImpl: typeof fetch = (async (...args: unknown[]) => {
      calls.push(args);
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;
    const target = { fetch: fetchImpl };
    const spy = installFetchSpy({ fetchImpl, target });
    await expect(
      target.fetch('https://m.example.edu/mod/quiz/attempt.php?finishattempt=1', { method: 'POST' }),
    ).rejects.toThrowError(/MQX-FILL-305/);
    expect(spy.blocked()).toBe(1);
    expect(calls.length).toBe(0);
  });

  it('blocks POST to /mod/quiz/attempt.php?processattempt=1', async () => {
    const fetchImpl: typeof fetch = (async () => new Response('ok', { status: 200 })) as unknown as typeof fetch;
    const target = { fetch: fetchImpl };
    const spy = installFetchSpy({ fetchImpl, target });
    await expect(
      target.fetch('https://m.example.edu/mod/quiz/attempt.php?processattempt=1', { method: 'POST' }),
    ).rejects.toThrowError(/MQX-FILL-305/);
    expect(spy.blocked()).toBe(1);
  });

  it('does not block GET to the same URL (preserves page working)', async () => {
    const fetchImpl: typeof fetch = (async () => new Response('ok', { status: 200 })) as unknown as typeof fetch;
    const target = { fetch: fetchImpl };
    const spy = installFetchSpy({ fetchImpl, target });
    await target.fetch('https://m.example.edu/mod/quiz/attempt.php?finishattempt=1');
    expect(spy.blocked()).toBe(0);
  });
});