// src/autofill/apply-plan.ts
//
// Build an immutable `ApplyPlan` from a parsed `AnswerList` and the
// extracted `QuizDocument`. Pure: no DOM, no browser APIs.
//
// The plan references questions by `stableFingerprint` (NOT by visible
// number). Moodle may reorder options between pages or skip numbers; the
// fingerprint is the only stable identifier across pagination.
//
// Strict semantics (per Phase 3 decisions):
//  - If any parsed answer targets a question whose `kind` is `unsupported`,
//    the plan is rejected with `MQX-FILL-308`. The user must complete
//    those by hand.
//  - If the answer letter does not exist in the question's `choices`,
//    the plan is rejected with `MQX-FILL-301`.
//  - If the question number is not present in the document, the plan is
//    rejected with `MQX-PARSE-103`.
//  - Duplicate answers for the same question collapse to the last one
//    (last-write-wins) with a warning.

import type {
  Question,
  QuestionKind,
  QuizDocument,
} from '~/domain/quiz-schema';
import { MQX, type MqxCode } from '~/diagnostics/codes';
import type { ParsedAnswer } from './answer-list-parser';

export type ApplyStepKind = 'radio' | 'checkbox' | 'short_text' | 'long_text' | 'select';

export interface ApplyStep {
  /** Stable fingerprint of the question this step targets. */
  readonly questionFingerprint: string;
  /** Visible question number, for UI display only. */
  readonly questionNumber: number;
  readonly kind: ApplyStepKind;
  /** For radio/checkbox/select: array of lowercase letters. For text: the raw string. */
  readonly value: ReadonlyArray<string> | string;
  /** Original line number from the answer list (for error reporting). */
  readonly sourceLine: number;
}

export interface ApplyPlan {
  readonly schemaVersion: '1.0';
  readonly steps: ReadonlyArray<ApplyStep>;
  readonly warnings: ReadonlyArray<ApplyPlanError>;
}

export interface ApplyPlanError {
  readonly code: MqxCode;
  readonly message: string;
  readonly questionNumber?: number;
  readonly sourceLine?: number;
}

export type ApplyPlanResult =
  | { ok: true; plan: ApplyPlan }
  | { ok: false; errors: ReadonlyArray<ApplyPlanError> };

type SupportedKind = Exclude<QuestionKind, 'unsupported'>;
type StepBuildResult = { step: ApplyStep } | { error: { code: MqxCode; message: string } };

export function buildApplyPlan(
  answers: ReadonlyArray<ParsedAnswer>,
  doc: QuizDocument,
): ApplyPlanResult {
  const errors: ApplyPlanError[] = [];
  const warnings: ApplyPlanError[] = [];

  // Index questions by visible number for direct lookup.
  const byNumber = new Map<number, Question>();
  for (const q of doc.questions) byNumber.set(q.number, q);

  // Last-write-wins: keep the last answer for each question number.
  const collapsed = new Map<number, ParsedAnswer>();
  for (const a of answers) {
    const prev = collapsed.get(a.questionNumber);
    if (prev !== undefined) {
      warnings.push({
        code: MQX.PARSE_INVALID_LETTER,
        message: `línea ${a.sourceLine}: respuesta duplicada para la pregunta ${a.questionNumber}, se conserva la última (línea ${prev.sourceLine} reemplazada)`,
        questionNumber: a.questionNumber,
        sourceLine: a.sourceLine,
      });
    }
    collapsed.set(a.questionNumber, a);
  }

  const steps: ApplyStep[] = [];
  // Iterate in document order so the apply loop processes questions top-to-bottom.
  const sorted = [...collapsed.values()].sort((a, b) => a.questionNumber - b.questionNumber);

  for (const a of sorted) {
    const q = byNumber.get(a.questionNumber);
    if (!q) {
      errors.push({
        code: MQX.PARSE_INVALID_LETTER,
        message: `pregunta ${a.questionNumber}: no existe en el cuestionario extraído`,
        questionNumber: a.questionNumber,
        sourceLine: a.sourceLine,
      });
      continue;
    }
    if (q.kind === 'unsupported') {
      errors.push({
        code: MQX.FILL_UNSUPPORTED_STRICT,
        message: `pregunta ${a.questionNumber}: tipo no soportado por el autollenado (resuelve a mano)`,
        questionNumber: a.questionNumber,
        sourceLine: a.sourceLine,
      });
      continue;
    }
    const step = buildStep(a, q);
    if ('error' in step) {
      errors.push({ ...step.error, questionNumber: a.questionNumber, sourceLine: a.sourceLine });
      continue;
    }
    steps.push(step.step);
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    plan: { schemaVersion: '1.0', steps, warnings },
  };
}

function buildStep(a: ParsedAnswer, q: Question): StepBuildResult {
  // Caller guarantees q.kind !== 'unsupported' (filtered in buildApplyPlan).
  // Narrow here so each builder gets a precise type.
  switch (q.kind) {
    case 'unsupported':
      throw new Error(`internal: buildStep received unsupported question #${q.number}`);
    case 'single_choice':
    case 'multiple_choice':
      return buildChoiceStep(a, q);
    case 'short_text':
    case 'long_text':
      return buildTextStep(a, q);
    case 'select':
      return buildSelectStep(a, q);
  }
}

function buildChoiceStep(a: ParsedAnswer, q: Question): StepBuildResult {
  if (q.kind !== 'single_choice' && q.kind !== 'multiple_choice') {
    throw new Error(`internal: buildChoiceStep received ${q.kind}`);
  }
  const available = new Set(q.choices.map((c) => c.letter.toLowerCase()));
  const requested = collectLetters(a);
  if (requested.length === 0) {
    return {
      error: {
        code: MQX.FILL_LETTER_NOT_FOUND,
        message: `pregunta ${a.questionNumber}: se esperaba una letra pero el contenido es texto libre`,
      },
    };
  }
  const missing = requested.filter((l) => !available.has(l));
  if (missing.length > 0) {
    return {
      error: {
        code: MQX.FILL_LETTER_NOT_FOUND,
        message: `pregunta ${a.questionNumber}: letra(s) no disponible(s): ${missing.join(', ')}`,
      },
    };
  }
  if (q.kind === 'single_choice' && requested.length > 1) {
    return {
      error: {
        code: MQX.FILL_LETTER_NOT_FOUND,
        message: `pregunta ${a.questionNumber}: selección única, pero se proporcionaron ${requested.length} letras`,
      },
    };
  }
  return {
    step: {
      questionFingerprint: q.stableFingerprint,
      questionNumber: q.number,
      kind: q.kind === 'single_choice' ? 'radio' : 'checkbox',
      value: requested,
      sourceLine: a.sourceLine,
    },
  };
}

function buildTextStep(a: ParsedAnswer, q: Question): StepBuildResult {
  if (q.kind !== 'short_text' && q.kind !== 'long_text') {
    throw new Error(`internal: buildTextStep received ${q.kind}`);
  }
  if (a.kind === 'letter' || a.kind === 'letters') {
    return {
      error: {
        code: MQX.FILL_LETTER_NOT_FOUND,
        message: `pregunta ${a.questionNumber}: se esperaba texto libre pero se proporcionaron letras`,
      },
    };
  }
  const text = typeof a.value === 'string' ? a.value : a.value.join('');
  const stepKind: ApplyStepKind = q.kind === 'short_text' ? 'short_text' : 'long_text';
  return {
    step: {
      questionFingerprint: q.stableFingerprint,
      questionNumber: q.number,
      kind: stepKind,
      value: text,
      sourceLine: a.sourceLine,
    },
  };
}

function buildSelectStep(a: ParsedAnswer, q: Question): StepBuildResult {
  if (q.kind !== 'select') {
    throw new Error(`internal: buildSelectStep received ${q.kind}`);
  }
  const available = new Set(q.choices.map((c) => c.letter.toLowerCase()));
  const requested = collectLetters(a);
  if (requested.length !== 1) {
    return {
      error: {
        code: MQX.FILL_LETTER_NOT_FOUND,
        message: `pregunta ${a.questionNumber}: selección única (dropdown) requiere exactamente una letra`,
      },
    };
  }
  const letter = requested[0]!;
  if (!available.has(letter)) {
    return {
      error: {
        code: MQX.FILL_LETTER_NOT_FOUND,
        message: `pregunta ${a.questionNumber}: letra no disponible en el dropdown: ${letter}`,
      },
    };
  }
  return {
    step: {
      questionFingerprint: q.stableFingerprint,
      questionNumber: q.number,
      kind: 'select',
      value: [letter],
      sourceLine: a.sourceLine,
    },
  };
}

function collectLetters(a: ParsedAnswer): string[] {
  if (Array.isArray(a.value)) return [...a.value];
  return [];
}