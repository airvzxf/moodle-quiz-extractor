// tests/unit/dom-adapter.spec.ts
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createDomAdapter } from '~/moodle/dom-adapter';
import { detectMoodleAttempt } from '~/moodle/detector';

const FIXTURES = [
  'tests/fixtures/redacted/ddoo-01-page-01.html',
  'tests/fixtures/redacted/ddoo-02-page-01.html',
  'tests/fixtures/redacted/dsop-01-page-01.html',
  'tests/fixtures/redacted/dsop-02-page-01.html',
] as const;

async function loadDom(path: string) {
  const html = await readFile(path, 'utf8');
  const { window } = new JSDOM(html, { url: 'https://ejemplo.mx/mod/quiz/attempt.php?attempt=__REDACTED__&cmid=__REDACTED__' });
  return createDomAdapter(window.document);
}

describe('dom-adapter (4 redacted fixtures)', () => {
  for (const path of FIXTURES) {
    describe(path.split('/').pop()!, () => {
      it('reports an attempt page', async () => {
        const dom = await loadDom(path);
        expect(dom.isAttemptPage()).toBe(true);
      });
      it('detects #responseform and >= 1 .que block', async () => {
        const dom = await loadDom(path);
        expect(dom.hasResponseForm()).toBe(true);
        expect(dom.hasQuestions()).toBe(true);
        expect(dom.listQuestions().length).toBe(10);
      });
      it('passes the supported detection branch', async () => {
        const dom = await loadDom(path);
        const r = detectMoodleAttempt(dom);
        expect(r).toEqual({ kind: 'supported', reason: 'attempt-page' });
      });
    });
  }

  it('returns notQuiz for non-attempt paths', async () => {
    const html = await readFile(FIXTURES[0], 'utf8');
    const { window } = new JSDOM(html, { url: 'https://ejemplo.mx/mod/quiz/view.php?id=1' });
    const dom = createDomAdapter(window.document);
    const r = detectMoodleAttempt(dom);
    expect(r).toEqual({ kind: 'notQuiz', reason: 'path-mismatch' });
  });

  it('ddoo-02 has NO section heading (null-safe)', async () => {
    const dom = await loadDom(FIXTURES[1]);
    expect(dom.getSectionHeading()).toBeNull();
  });

  it('ddoo-01, dsop-01, dsop-02 each have a section heading', async () => {
    for (const path of FIXTURES.filter((p) => !p.includes('ddoo-02'))) {
      const dom = await loadDom(path);
      expect(dom.getSectionHeading()).not.toBeNull();
    }
  });
});
