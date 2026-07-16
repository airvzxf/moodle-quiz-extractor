// tests/unit/parsers.spec.ts
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createDomAdapter } from '~/moodle/dom-adapter';
import { parseQuestion } from '~/moodle/parsers/registry';
import { fingerprint } from '~/domain/quiz-schema';

async function parseFixture(path: string) {
  const html = await readFile(path, 'utf8');
  const { window } = new JSDOM(html, {
    url: 'https://ejemplo.mx/mod/quiz/attempt.php?attempt=__REDACTED__&cmid=__REDACTED__',
  });
  const dom = createDomAdapter(window.document);
  const questions = dom.listQuestions();
  const warns: string[] = [];
  return Promise.all(
    questions.map((q) =>
      parseQuestion(q, {
        fingerprint,
        warn: (code, msg) => warns.push(`${code}:${msg}`),
      }),
    ),
  );
}

async function parseSnippet(html: string) {
  const { window } = new JSDOM(html, {
    url: 'https://ejemplo.mx/mod/quiz/attempt.php?attempt=__REDACTED__&cmid=__REDACTED__',
  });
  const dom = createDomAdapter(window.document);
  const questions = dom.listQuestions();
  const warns: string[] = [];
  const parsed = await Promise.all(
    questions.map((q) =>
      parseQuestion(q, {
        fingerprint,
        warn: (code, msg) => warns.push(`${code}:${msg}`),
      }),
    ),
  );
  return { parsed, warns };
}

describe('parser registry (4 redacted fixtures)', () => {
  it('dsop-01: 10 single_choice, 4 options each, letters a-d', async () => {
    const qs = await parseFixture('tests/fixtures/redacted/dsop-01-page-01.html');
    expect(qs).toHaveLength(10);
    for (const q of qs) {
      expect(q.kind).toBe('single_choice');
      expect(q.choices).toHaveLength(4);
      expect(q.choices.map((c) => c.letter)).toEqual(['a', 'b', 'c', 'd']);
    }
  });

  it('dsop-02: 9 single_choice + 1 multiple_choice with 4 options', async () => {
    const qs = await parseFixture('tests/fixtures/redacted/dsop-02-page-01.html');
    expect(qs).toHaveLength(10);
    const radios = qs.filter((q) => q.kind === 'single_choice');
    const checks = qs.filter((q) => q.kind === 'multiple_choice');
    expect(radios).toHaveLength(9);
    expect(checks).toHaveLength(1);
    expect(checks[0]?.choices).toHaveLength(4);
  });

  it('ddoo-01: 10 single_choice, 4 options each (the question-flag checkbox is outside .answer)', async () => {
    const qs = await parseFixture('tests/fixtures/redacted/ddoo-01-page-01.html');
    expect(qs).toHaveLength(10);
    for (const q of qs) {
      expect(q.kind).toBe('single_choice');
      expect(q.choices).toHaveLength(4);
    }
  });

  it('ddoo-02: 10 single_choice (one question has only 3 options: 39 radios / 10 questions)', async () => {
    const qs = await parseFixture('tests/fixtures/redacted/ddoo-02-page-01.html');
    expect(qs).toHaveLength(10);
    const sizes = qs.map((q) => q.choices.length).sort();
    expect(sizes).toEqual([3, 4, 4, 4, 4, 4, 4, 4, 4, 4]);
  });

  it('every question gets a stableFingerprint of 64 hex chars', async () => {
    const qs = await parseFixture('tests/fixtures/redacted/dsop-01-page-01.html');
    for (const q of qs) {
      expect(q.stableFingerprint).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('fingerprint is stable across re-parsing (same input -> same output)', async () => {
    const a = await parseFixture('tests/fixtures/redacted/dsop-01-page-01.html');
    const b = await parseFixture('tests/fixtures/redacted/dsop-01-page-01.html');
    for (let i = 0; i < a.length; i++) {
      expect(a[i]?.stableFingerprint).toBe(b[i]?.stableFingerprint);
    }
  });

  it('no question leaks input names, attempt ids, or sesskey', async () => {
    const qs = await parseFixture('tests/fixtures/redacted/dsop-02-page-01.html');
    const serialized = JSON.stringify(qs);
    expect(serialized).not.toMatch(/sesskey=[A-Za-z0-9]+(?![_])/);
    expect(serialized).not.toMatch(/name="q\d+:\d+_/);
    expect(serialized).not.toMatch(/MoodleSession[\w-]*=[A-Za-z0-9]+(?![_])/);
  });

  it('every choice has a non-empty human label (rendered from .r0/.r1 text)', async () => {
    const qs = await parseFixture('tests/fixtures/redacted/dsop-01-page-01.html');
    for (const q of qs) {
      for (const c of q.choices) {
        expect(c.letter).toMatch(/^[a-z]$/);
        expect(c.sourceAnchor).toMatch(/^[a-z]$/);
        expect(c.label.length).toBeGreaterThan(2);
      }
    }
  });

  it('stableFingerprint differs across questions (not a single global hash)', async () => {
    const qs = await parseFixture('tests/fixtures/redacted/dsop-01-page-01.html');
    const fps = new Set(qs.map((q) => q.stableFingerprint));
    expect(fps.size).toBe(qs.length);
  });
});
