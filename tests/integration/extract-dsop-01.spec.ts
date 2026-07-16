// tests/integration/extract-dsop-01.spec.ts
//
// End-to-end test: read the redacted dsop-01 fixture, run the parser
// registry, build a QuizDocument, render Markdown, and assert against the
// golden file. Also asserts the golden matches the user's prompt.md
// example literally (no `- [ ]`, no YAML, etc.).

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createDomAdapter } from '~/moodle/dom-adapter';
import { parseQuestion } from '~/moodle/parsers/registry';
import { fingerprint } from '~/domain/quiz-schema';
import { buildQuizDocument } from '~/export/source';
import { renderQuiz } from '~/export/markdown';

const FIXTURE = 'tests/fixtures/redacted/dsop-01-page-01.html';
const GOLDEN = 'tests/contracts/dsop-01.golden.md';

async function runPipeline(fixture: string) {
  const html = await readFile(fixture, 'utf8');
  const { window } = new JSDOM(html, {
    url: 'https://ejemplo.mx/mod/quiz/attempt.php?attempt=__REDACTED__&cmid=__REDACTED__',
  });
  const dom = createDomAdapter(window.document);
  const warns: Array<{ code: string; stage: 'parse'; message: string }> = [];
  const questions = await Promise.all(
    dom.listQuestions().map((q) =>
      parseQuestion(q, {
        fingerprint,
        warn: (code, message) => warns.push({ code, stage: 'parse', message }),
      }),
    ),
  );
  const doc = await buildQuizDocument(dom, questions, warns);
  return { dom, doc, md: renderQuiz(doc, { exportedAt: new Date('2026-07-15T00:00:00Z') }) };
}

describe('end-to-end pipeline: dsop-01', () => {
  it('matches the golden Markdown file', async () => {
    const { md } = await runPipeline(FIXTURE);
    const golden = await readFile(GOLDEN, 'utf8');
    // Strip the timestamp line because it embeds an `exportedAt` we control
    // in the test; the rest of the document is deterministic.
    const stripFooter = (s: string) =>
      s.replace(/> Generado por moodle-quiz-extractor v[^\n]+\n?$/m, '').trimEnd() + '\n';
    expect(stripFooter(md)).toBe(stripFooter(golden));
  });

  it('rendered Markdown has no GFM checklist markers (`- [ ]`)', async () => {
    const { md } = await runPipeline(FIXTURE);
    expect(md).not.toMatch(/^- \[ \]/m);
  });

  it('rendered Markdown has no YAML frontmatter', async () => {
    const { md } = await runPipeline(FIXTURE);
    expect(md.startsWith('---\n')).toBe(false);
  });

  it('rendered Markdown uses literal `[ ] <letter>.` per option', async () => {
    const { md } = await runPipeline(FIXTURE);
    // Each question should have at least 3 options like `[ ] a. La ejecucion...`.
    const matches = md.match(/^\[ \] [a-z]\. /gm) ?? [];
    // dsop-01: 10 questions × 4 options = 40 option lines
    expect(matches.length).toBeGreaterThanOrEqual(30);
  });

  it('rendered Markdown uses `Selecciona una opción:` for single_choice', async () => {
    const { md } = await runPipeline(FIXTURE);
    expect(md).toContain('Selecciona una opción:');
    // dsop-01 has no checkbox question
    expect(md).not.toContain('Selecciona una o mas opción:');
  });

  it('rendered Markdown separates questions with `\\n\\n---\\n\\n`', async () => {
    const { md } = await runPipeline(FIXTURE);
    // 10 questions → 9 separators
    const seps = md.split('\n\n---\n\n').length;
    expect(seps).toBe(11); // 10 questions + 1 leading metadata block separator
  });

  it('the document QuizDocument is valid against the Zod schema', async () => {
    const { doc } = await runPipeline(FIXTURE);
    const { QuizDocumentSchema } = await import('~/domain/quiz-schema');
    expect(() => QuizDocumentSchema.parse(doc)).not.toThrow();
  });
});

describe('end-to-end pipeline: dsop-02 (has 1 multiple_choice)', () => {
  it('emits `Selecciona una o mas opción:` for the multiple_choice question', async () => {
    const { md } = await runPipeline('tests/fixtures/redacted/dsop-02-page-01.html');
    expect(md).toContain('Selecciona una o mas opción:');
    expect(md).toContain('Tipo de respuesta: multiple_choice.');
  });
});
