// tests/unit/preview-validator.spec.ts

import { describe, it, expect } from 'vitest';
import type { Question, QuizDocument } from '~/domain/quiz-schema';
import type { ApplyPlan, ApplyStep } from '~/autofill/apply-plan';
import { validatePlan } from '~/autofill/preview-validator';

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    number: 1,
    stableFingerprint: 'a'.repeat(64),
    kind: 'single_choice',
    promptMarkdown: 'Pregunta 1',
    choices: [
      { letter: 'a', label: 'A' },
      { letter: 'b', label: 'B' },
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

function step(overrides: Partial<ApplyStep>): ApplyStep {
  return {
    questionFingerprint: 'a'.repeat(64),
    questionNumber: 1,
    kind: 'radio',
    value: ['a'],
    sourceLine: 1,
    ...overrides,
  };
}

function plan(steps: ApplyStep[], warnings: ApplyPlan['warnings'] = []): ApplyPlan {
  return { schemaVersion: '1.0', steps, warnings };
}

describe('validatePlan — happy path', () => {
  it('passes through when all fingerprints match and kinds match', () => {
    const doc = makeDoc([makeQuestion({ number: 1 })]);
    const r = validatePlan(plan([step({ kind: 'radio', value: ['a'] })]), doc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.revalidated).toBe(1);
  });

  it('revalidates multiple steps', () => {
    const doc = makeDoc([
      makeQuestion({ number: 1, stableFingerprint: 'a'.repeat(64) }),
      makeQuestion({ number: 2, stableFingerprint: 'b'.repeat(64), kind: 'multiple_choice' }),
    ]);
    const r = validatePlan(plan([
      step({ kind: 'radio', value: ['a'], questionFingerprint: 'a'.repeat(64), questionNumber: 1 }),
      step({ kind: 'checkbox', value: ['a', 'b'], questionFingerprint: 'b'.repeat(64), questionNumber: 2 }),
    ]), doc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.revalidated).toBe(2);
  });
});

describe('validatePlan — fingerprint mismatch', () => {
  it('returns MQX-FILL-307 when the fingerprint is not in the current document', () => {
    const doc = makeDoc([makeQuestion({ number: 1, stableFingerprint: 'a'.repeat(64) })]);
    const r = validatePlan(plan([step({ questionFingerprint: 'c'.repeat(64) })]), doc);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]?.code).toBe('MQX-FILL-307');
  });

  it('returns MQX-FILL-307 when the question kind changed', () => {
    const doc = makeDoc([makeQuestion({ number: 1, kind: 'multiple_choice' })]);
    const r = validatePlan(plan([step({ kind: 'radio' })]), doc);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]?.code).toBe('MQX-FILL-307');
  });

  it('warns (does not fail) when the letter is missing but the question is present', () => {
    const doc = makeDoc([makeQuestion({
      number: 1,
      kind: 'multiple_choice',
      choices: [{ letter: 'a', label: 'A' }, { letter: 'b', label: 'B' }],
    })]);
    const r = validatePlan(plan([step({ kind: 'checkbox', value: ['a', 'z'] })]), doc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.warnings.some((w) => w.code === 'MQX-FILL-307')).toBe(true);
    expect(r.result.revalidated).toBe(1);
  });
});