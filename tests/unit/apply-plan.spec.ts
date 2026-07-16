// tests/unit/apply-plan.spec.ts

import { describe, it, expect } from 'vitest';
import type { Question, QuizDocument } from '~/domain/quiz-schema';
import { buildApplyPlan } from '~/autofill/apply-plan';
import type { ParsedAnswer } from '~/autofill/answer-list-parser';

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    number: 1,
    stableFingerprint: 'a'.repeat(64),
    kind: 'single_choice',
    instruction: undefined,
    promptMarkdown: 'Pregunta 1',
    choices: [
      { letter: 'a', label: 'A', sourceAnchor: 'a' },
      { letter: 'b', label: 'B', sourceAnchor: 'b' },
      { letter: 'c', label: 'C', sourceAnchor: 'c' },
      { letter: 'd', label: 'D', sourceAnchor: 'd' },
    ],
    metadata: {},
    assets: [],
    supportedForAutofill: true,
    warnings: [],
    ...overrides,
  };
}

function makeDoc(questions: ReadonlyArray<Question>): QuizDocument {
  return {
    schemaVersion: '1.0',
    title: 'Test',
    questions: [...questions],
    source: {
      originHash: 'b'.repeat(64),
      path: '/mod/quiz/attempt.php',
      pageCount: 1,
      exportedAt: '2026-07-16T00:00:00.000Z',
    },
    warnings: [],
  };
}

function ans(questionNumber: number, value: string, kind: 'letter' | 'letters' | 'text' = 'letter', line = 1): ParsedAnswer {
  if (kind === 'text') {
    return { questionNumber, sourceLine: line, kind, value };
  }
  return {
    questionNumber,
    sourceLine: line,
    kind,
    value: kind === 'letter' ? [value] : value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  };
}

describe('buildApplyPlan — happy paths', () => {
  it('builds a radio step for a single_choice answer', () => {
    const doc = makeDoc([makeQuestion({ number: 1 })]);
    const r = buildApplyPlan([ans(1, 'a', 'letter')], doc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.steps).toHaveLength(1);
    expect(r.plan.steps[0]).toMatchObject({ kind: 'radio', value: ['a'] });
  });

  it('builds a checkbox step for a multiple_choice answer', () => {
    const doc = makeDoc([makeQuestion({
      number: 1,
      kind: 'multiple_choice',
      choices: [
        { letter: 'a', label: 'A' },
        { letter: 'b', label: 'B' },
        { letter: 'c', label: 'C' },
      ],
    })]);
    const r = buildApplyPlan([ans(1, 'a,b', 'letters')], doc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.steps[0]).toMatchObject({ kind: 'checkbox', value: ['a', 'b'] });
  });

  it('builds a short_text step', () => {
    const doc = makeDoc([makeQuestion({
      number: 1,
      kind: 'short_text',
      choices: [],
    })]);
    const r = buildApplyPlan([ans(1, 'hola mundo', 'text')], doc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.steps[0]?.kind).toBe('short_text');
    expect(r.plan.steps[0]?.value).toBe('hola mundo');
  });

  it('builds a long_text step', () => {
    const doc = makeDoc([makeQuestion({
      number: 1,
      kind: 'long_text',
      choices: [],
    })]);
    const r = buildApplyPlan([ans(1, 'párrafo largo', 'text')], doc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.steps[0]?.kind).toBe('long_text');
  });

  it('builds a select step with exactly one letter', () => {
    const doc = makeDoc([makeQuestion({
      number: 1,
      kind: 'select',
      choices: [
        { letter: 'a', label: 'A' },
        { letter: 'b', label: 'B' },
      ],
    })]);
    const r = buildApplyPlan([ans(1, 'b', 'letter')], doc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.steps[0]?.kind).toBe('select');
    expect(r.plan.steps[0]?.value).toEqual(['b']);
  });
});

describe('buildApplyPlan — strict errors', () => {
  it('rejects answers for questions not in the document (MQX-PARSE-103)', () => {
    const doc = makeDoc([makeQuestion({ number: 1 })]);
    const r = buildApplyPlan([ans(5, 'a', 'letter')], doc);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]?.code).toBe('MQX-PARSE-103');
    expect(r.errors[0]?.questionNumber).toBe(5);
  });

  it('rejects answers for unsupported questions (MQX-FILL-308)', () => {
    const doc = makeDoc([makeQuestion({ number: 1, kind: 'unsupported' as Question['kind'] })]);
    const r = buildApplyPlan([ans(1, 'a', 'letter')], doc);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]?.code).toBe('MQX-FILL-308');
  });

  it('rejects letters not in the choices (MQX-FILL-301)', () => {
    const doc = makeDoc([makeQuestion({
      number: 1,
      kind: 'multiple_choice',
      choices: [{ letter: 'a', label: 'A' }, { letter: 'b', label: 'B' }],
    })]);
    const r = buildApplyPlan([ans(1, 'a,z', 'letters')], doc);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]?.code).toBe('MQX-FILL-301');
  });

  it('rejects multiple letters for single_choice (MQX-FILL-301)', () => {
    const doc = makeDoc([makeQuestion({ number: 1, kind: 'single_choice' })]);
    const r = buildApplyPlan([ans(1, 'a,b', 'letters')], doc);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]?.code).toBe('MQX-FILL-301');
  });

  it('rejects text answers for short_text when value is letters', () => {
    const doc = makeDoc([makeQuestion({ number: 1, kind: 'short_text', choices: [] })]);
    const r = buildApplyPlan([ans(1, 'a', 'letter')], doc);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]?.code).toBe('MQX-FILL-301');
  });

  it('rejects multiple letters for select (MQX-FILL-301)', () => {
    const doc = makeDoc([makeQuestion({
      number: 1,
      kind: 'select',
      choices: [{ letter: 'a', label: 'A' }, { letter: 'b', label: 'B' }],
    })]);
    const r = buildApplyPlan([ans(1, 'a,b', 'letters')], doc);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]?.code).toBe('MQX-FILL-301');
  });
});

describe('buildApplyPlan — warnings', () => {
  it('collapses duplicate answers for the same question (last-write-wins)', () => {
    const doc = makeDoc([makeQuestion({ number: 1 })]);
    const r = buildApplyPlan([ans(1, 'a', 'letter', 1), ans(1, 'b', 'letter', 2)], doc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.steps).toHaveLength(1);
    expect(r.plan.steps[0]?.value).toEqual(['b']);
    expect(r.plan.warnings).toHaveLength(1);
    expect(r.plan.warnings[0]?.code).toBe('MQX-PARSE-103');
  });
});