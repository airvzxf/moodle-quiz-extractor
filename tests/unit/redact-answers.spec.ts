// tests/unit/redact-answers.spec.ts

import { describe, it, expect } from 'vitest';
import { redactAnswer, redactParsedAnswers } from '~/autofill/redact-answers';
import { MqxPrivLeakError } from '~/diagnostics/redactor';
import type { ParsedAnswer } from '~/autofill/answer-list-parser';

describe('redactAnswer', () => {
  it('returns the same answer when content is safe', () => {
    const a: ParsedAnswer = {
      questionNumber: 1,
      sourceLine: 1,
      kind: 'text',
      value: 'Mi respuesta honesta',
    };
    const out = redactAnswer(a);
    expect(out.value).toBe('Mi respuesta honesta');
    expect(out.questionNumber).toBe(1);
  });

  it('throws on a sesskey leak', () => {
    const a: ParsedAnswer = {
      questionNumber: 1,
      sourceLine: 1,
      kind: 'text',
      value: 'sesskey=leakedtoken123',
    };
    expect(() => redactAnswer(a)).toThrow(MqxPrivLeakError);
  });

  it('redacts each letter in a checkbox answer', () => {
    const a: ParsedAnswer = {
      questionNumber: 1,
      sourceLine: 1,
      kind: 'letters',
      value: ['a', 'b'],
    };
    const out = redactAnswer(a);
    expect(out.value).toEqual(['a', 'b']);
  });
});

describe('redactParsedAnswers', () => {
  it('applies per answer and preserves ordering', () => {
    const list: ParsedAnswer[] = [
      { questionNumber: 1, sourceLine: 1, kind: 'text', value: 'ok' },
      { questionNumber: 2, sourceLine: 2, kind: 'letter', value: ['a'] },
    ];
    const out = redactParsedAnswers(list);
    expect(out).toHaveLength(2);
    expect(out[0]?.value).toBe('ok');
    expect(out[1]?.value).toEqual(['a']);
  });
});