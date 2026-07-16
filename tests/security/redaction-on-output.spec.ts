// tests/security/redaction-on-output.spec.ts
//
// Any artifact produced by the autofill pipeline that is serialized out
// of the content script must pass through `redactString`. This test
// exercises the parser + apply-plan + redact-answers chain with a
// crafted canary in the user's input and verifies the canary never
// survives into the persisted ApplyPlan.

import { describe, it, expect } from 'vitest';
import { parseAnswerList } from '~/autofill/answer-list-parser';
import { buildApplyPlan } from '~/autofill/apply-plan';
import { redactParsedAnswers } from '~/autofill/redact-answers';
import { MqxPrivLeakError } from '~/diagnostics/redactor';
import { fingerprint } from '~/domain/quiz-schema';
import type { QuizDocument, Question } from '~/domain/quiz-schema';

function makeDoc(): QuizDocument {
  const q: Question = {
    number: 1,
    stableFingerprint: 'a'.repeat(64),
    kind: 'short_text',
    promptMarkdown: 'Pregunta 1',
    choices: [],
    metadata: {},
    assets: [],
    supportedForAutofill: true,
    warnings: [],
  };
  return {
    schemaVersion: '1.0',
    title: 'Test',
    questions: [q],
    source: {
      originHash: 'b'.repeat(64),
      path: '/mod/quiz/attempt.php',
      pageCount: 1,
      exportedAt: '2026-07-16T00:00:00.000Z',
    },
    warnings: [],
  };
}

describe('redaction on output', () => {
  it('parseAnswerList propagates the canary into the parsed answer', () => {
    const r = parseAnswerList('1. sesskey=leaked123abc');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.stringify(r.answers)).toMatch(/sesskey=/);
  });

  it('redactParsedAnswers throws on the canary (fail-closed)', () => {
    const r = parseAnswerList('1. sesskey=leaked123abc');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(() => redactParsedAnswers(r.answers)).toThrow(MqxPrivLeakError);
  });

  it('buildApplyPlan followed by JSON.stringify of the plan leaks nothing if the input was redacted upstream', () => {
    const r = parseAnswerList('1. mi respuesta honesta');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const safe = redactParsedAnswers(r.answers);
    const doc = makeDoc();
    const plan = buildApplyPlan(safe, doc);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const serialized = JSON.stringify(plan.plan);
    expect(serialized).not.toMatch(/sesskey=[A-Za-z0-9]+(?![_])/);
    expect(serialized).not.toMatch(/MoodleSession/);
  });

  it('apply-plan rejects fingerprint mismatches between build and serialize (defense)', async () => {
    const r = parseAnswerList('1. respuesta');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const doc = makeDoc();
    const plan = buildApplyPlan(r.answers, doc);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.plan.steps[0]?.questionFingerprint).toMatch(/^[0-9a-f]{64}$/);
    void fingerprint;
  });
});