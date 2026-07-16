// tests/unit/parsers-text-select.spec.ts
//
// Unit tests for the three parsers added in PR #17: short_text,
// long_text, and select. Each test renders a minimal Moodle HTML
// snippet through jsdom and asserts the parsed Question structure.

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { createDomAdapter } from '~/moodle/dom-adapter';
import { parseShortText } from '~/moodle/parsers/short-text';
import { parseLongText } from '~/moodle/parsers/long-text';
import { parseSelect } from '~/moodle/parsers/select';
import { fingerprint } from '~/domain/quiz-schema';
import type { ParseContext } from '~/moodle/parsers/registry';

function ctx(warns: string[]): ParseContext {
  return { fingerprint, warn: (code, msg) => warns.push(`${code}:${msg}`) };
}

function parseFromHtml<T>(html: string, fn: (q: ParseContext, dom: ReturnType<typeof createDomAdapter>) => Promise<T>): Promise<T> {
  const { window } = new JSDOM(html, {
    url: 'https://ejemplo.mx/mod/quiz/attempt.php?attempt=__REDACTED__&cmid=__REDACTED__',
  });
  const dom = createDomAdapter(window.document);
  const questions = dom.listQuestions();
  const warns: string[] = [];
  return fn(ctx(warns), { ...dom, listQuestions: () => questions } as unknown as ParseContext extends never ? never : never) as never;
}

async function parseFirst(html: string, parser: (q: Parameters<typeof parseShortText>[0], c: ParseContext) => Promise<unknown>): Promise<{ result: any; warnings: string[] }> {
  const { window } = new JSDOM(html, {
    url: 'https://ejemplo.mx/mod/quiz/attempt.php?attempt=__REDACTED__&cmid=__REDACTED__',
  });
  const dom = createDomAdapter(window.document);
  const questions = dom.listQuestions();
  expect(questions).toHaveLength(1);
  const warns: string[] = [];
  const result = await parser(questions[0]!, { fingerprint, warn: (c, m) => warns.push(`${c}:${m}`) });
  return { result, warnings: warns };
}

describe('parseShortText', () => {
  const SHORT_TEXT_HTML = `
    <div class="que shortanswer">
      <div class="qno">1</div>
      <div class="qtext">What is the capital of France?</div>
      <div class="answer">
        <input type="text" name="q1:1_answer" id="q1_1_answer" />
      </div>
    </div>
  `;

  it('returns kind=short_text with empty choices', async () => {
    const { result, warnings } = await parseFirst(SHORT_TEXT_HTML, parseShortText);
    expect(result.kind).toBe('short_text');
    expect(result.number).toBe(1);
    expect(result.choices).toEqual([]);
    expect(result.promptMarkdown).toContain('capital of France');
    expect(result.supportedForAutofill).toBe(true);
    expect(result.warnings).toEqual([]);
    void warnings;
  });

  it('returns a 64-hex-char fingerprint', async () => {
    const { result } = await parseFirst(SHORT_TEXT_HTML, parseShortText);
    expect(result.stableFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns kind=unsupported when no input is present', async () => {
    const { result } = await parseFirst(`
      <div class="que shortanswer">
        <div class="qno">1</div>
        <div class="qtext">No input here</div>
        <div class="answer"></div>
      </div>
    `, parseShortText);
    expect(result.kind).toBe('unsupported');
    expect(result.supportedForAutofill).toBe(false);
  });
});

describe('parseLongText', () => {
  const LONG_TEXT_HTML = `
    <div class="que essay">
      <div class="qno">2</div>
      <div class="qtext">Explain monads in your own words.</div>
      <div class="answer">
        <textarea name="q2:1_answer" rows="10" cols="60"></textarea>
      </div>
    </div>
  `;

  it('returns kind=long_text with empty choices', async () => {
    const { result } = await parseFirst(LONG_TEXT_HTML, parseLongText);
    expect(result.kind).toBe('long_text');
    expect(result.number).toBe(2);
    expect(result.choices).toEqual([]);
    expect(result.supportedForAutofill).toBe(true);
  });

  it('returns a 64-hex-char fingerprint', async () => {
    const { result } = await parseFirst(LONG_TEXT_HTML, parseLongText);
    expect(result.stableFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns kind=unsupported when no textarea is present', async () => {
    const { result } = await parseFirst(`
      <div class="que essay">
        <div class="qno">2</div>
        <div class="qtext">No textarea</div>
        <div class="answer"></div>
      </div>
    `, parseLongText);
    expect(result.kind).toBe('unsupported');
  });
});

describe('parseSelect', () => {
  const SELECT_HTML = `
    <div class="que multichoice">
      <div class="qno">3</div>
      <div class="qtext">Pick a color</div>
      <div class="answer">
        <select name="q3:1_answer">
          <option value="">Choose...</option>
          <option value="0">a. Red</option>
          <option value="1">b. Green</option>
          <option value="2">c. Blue</option>
        </select>
      </div>
    </div>
  `;

  it('parses letters from the option text prefix', async () => {
    const { result } = await parseFirst(SELECT_HTML, parseSelect);
    expect(result.kind).toBe('select');
    expect(result.choices.map((c: { letter: string }) => c.letter)).toEqual(['a', 'b', 'c']);
    expect(result.choices.map((c: { label: string }) => c.label)).toEqual(['a. Red', 'b. Green', 'c. Blue']);
    expect(result.supportedForAutofill).toBe(true);
  });

  it('falls back to synthetic letters when the option text has no prefix', async () => {
    const html = `
      <div class="que multichoice">
        <div class="qno">3</div>
        <div class="qtext">Pick</div>
        <div class="answer">
          <select name="q3:1_answer">
            <option value=""></option>
            <option value="0">Red</option>
            <option value="1">Green</option>
          </select>
        </div>
      </div>
    `;
    const { result } = await parseFirst(html, parseSelect);
    expect(result.choices.map((c: { letter: string }) => c.letter)).toEqual(['a', 'b']);
  });

  it('skips disabled options and the empty placeholder', async () => {
    const { result } = await parseFirst(SELECT_HTML, parseSelect);
    expect(result.choices).toHaveLength(3);
  });

  it('returns kind=unsupported when no select is present', async () => {
    const { result } = await parseFirst(`
      <div class="que">
        <div class="qno">3</div>
        <div class="qtext">No select</div>
        <div class="answer"></div>
      </div>
    `, parseSelect);
    expect(result.kind).toBe('unsupported');
  });

  it('returns kind=unsupported when all options are empty/disabled', async () => {
    const { result } = await parseFirst(`
      <div class="que">
        <div class="qno">3</div>
        <div class="qtext">Empty select</div>
        <div class="answer">
          <select name="q3:1_answer">
            <option value="">Choose...</option>
            <option value="-1" disabled>Clear</option>
          </select>
        </div>
      </div>
    `, parseSelect);
    expect(result.kind).toBe('unsupported');
  });
});

// Keep parser suite exported under one file; ignore the helper that we
// don't actually use (lint: prefer no unused).
void parseFromHtml;