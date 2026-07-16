// tests/unit/answer-list-parser.spec.ts
//
// Pure parser tests. Covers the BNF documented in README.md §Formato de
// respuestas and the edge cases the parser promises to handle.

import { describe, it, expect } from 'vitest';
import { parseAnswerList } from '~/autofill/answer-list-parser';

describe('parseAnswerList — happy path', () => {
  it('parses the README example verbatim', () => {
    const input = [
      '1. a)',
      '2. c)',
      '3. a,c',
      '4. d)',
      '5. Mi respuesta se basa en los fundamentos del desarrollo del software.',
    ].join('\n');
    const r = parseAnswerList(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answers).toHaveLength(5);
    expect(r.answers[0]).toMatchObject({ questionNumber: 1, kind: 'letter', value: ['a'] });
    expect(r.answers[1]).toMatchObject({ questionNumber: 2, kind: 'letter', value: ['c'] });
    expect(r.answers[2]).toMatchObject({ questionNumber: 3, kind: 'letters', value: ['a', 'c'] });
    expect(r.answers[3]).toMatchObject({ questionNumber: 4, kind: 'letter', value: ['d'] });
    expect(r.answers[4]).toMatchObject({ questionNumber: 5, kind: 'text', value: expect.any(String) });
  });

  it('treats a, b, c, d (with spaces) as multiple letters', () => {
    const r = parseAnswerList('1. a, b ,c');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answers[0]?.kind).toBe('letters');
    expect(r.answers[0]?.value).toEqual(['a', 'b', 'c']);
  });

  it('deduplicates repeated letters into a single-letter answer', () => {
    const r = parseAnswerList('3. a,a,a');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answers[0]?.kind).toBe('letter');
    expect(r.answers[0]?.value).toEqual(['a']);
  });
});

describe('parseAnswerList — separators and bullets', () => {
  it.each([
    ['1. a', ['a']],
    ['1. a)', ['a']],
    ['1. a.', ['a']],
    ['1. a]', ['a']],
    ['1. A', ['a']],
    ['1. A.', ['a']],
  ])('parses "%s" as letter %p', (line, expected) => {
    const r = parseAnswerList(line);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answers[0]?.kind).toBe('letter');
    expect(r.answers[0]?.value).toEqual(expected);
  });

  it('accepts ")" as the bullet', () => {
    const r = parseAnswerList('2) b');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answers[0]?.questionNumber).toBe(2);
    expect(r.answers[0]?.value).toEqual(['b']);
  });

  it('accepts "." as the bullet', () => {
    const r = parseAnswerList('2. b');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answers[0]?.questionNumber).toBe(2);
  });
});

describe('parseAnswerList — empty and comments', () => {
  it('skips empty lines', () => {
    const r = parseAnswerList('\n\n1. a\n\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answers).toHaveLength(1);
  });

  it('skips comment lines starting with #', () => {
    const r = parseAnswerList('# header\n1. a\n# trailing');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answers).toHaveLength(1);
  });

  it('records sourceLine on every answer', () => {
    const r = parseAnswerList('# comment\n\n1. a\n2. b');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answers[0]?.sourceLine).toBe(3);
    expect(r.answers[1]?.sourceLine).toBe(4);
  });
});

describe('parseAnswerList — errors', () => {
  it('rejects a line without a number', () => {
    const r = parseAnswerList('hello world');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]?.code).toBe('MQX-PARSE-103');
    expect(r.errors[0]?.sourceLine).toBe(1);
  });

  it('rejects a line with a number but no content', () => {
    const r = parseAnswerList('1.');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toHaveLength(1);
  });

  it('collects multiple errors at once', () => {
    const r = parseAnswerList('foo\nbar\n1. a');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toHaveLength(2);
  });

  it('strips a leading BOM', () => {
    const r = parseAnswerList('\uFEFF1. a');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answers).toHaveLength(1);
  });

  it('handles CRLF line endings', () => {
    const r = parseAnswerList('1. a\r\n2. b\r\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answers).toHaveLength(2);
  });

  it('treats a content with digits as free text', () => {
    const r = parseAnswerList('1. respuesta con 42 números');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answers[0]?.kind).toBe('text');
  });
});

describe('parseAnswerList — only-separator content', () => {
  it('treats "a," as letters (a) after trimming trailing separators', () => {
    const r = parseAnswerList('1. a,');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answers[0]?.kind).toBe('letter');
  });

  it('warns when content has no letters and stores as text', () => {
    const r = parseAnswerList('1. -');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answers[0]?.kind).toBe('text');
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]?.code).toBe('MQX-PARSE-103');
  });
});