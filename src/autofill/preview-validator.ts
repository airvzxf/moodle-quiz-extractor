// src/autofill/preview-validator.ts
//
// Re-validate an ApplyPlan against the live QuizDocument after pagination
// or any DOM mutation that could change question fingerprints.
//
// Pure: no DOM. Returns a Result so callers can decide whether to abort
// the job or just emit a warning.
//
// Decisions (Phase 3):
//  - If a step's `questionFingerprint` is missing from the current
//    document, that's a hard failure (the question disappeared).
//  - If a step's `questionFingerprint` is present but the corresponding
//    `kind` changed (e.g. Moodle served the page without `<textarea>`s),
//    that's a hard failure with `MQX-FILL-307`.
//  - If a step's letter is missing from the live choices (Moodle
//    re-ordered options), emit `MQX-FILL-307` as a warning and re-resolve
//    by index if possible.

import type { QuizDocument, Question } from '~/domain/quiz-schema';
import { MQX, type MqxCode } from '~/diagnostics/codes';
import type { ApplyPlan, ApplyPlanError } from './apply-plan';

export interface PreviewValidationResult {
  readonly plan: ApplyPlan;
  readonly warnings: ReadonlyArray<ApplyPlanError>;
  readonly revalidated: number;
}

export type PreviewValidationOutcome =
  | { ok: true; result: PreviewValidationResult }
  | { ok: false; errors: ReadonlyArray<ApplyPlanError> };

export function validatePlan(
  plan: ApplyPlan,
  currentDoc: QuizDocument,
): PreviewValidationOutcome {
  const errors: ApplyPlanError[] = [];
  const warnings: ApplyPlanError[] = [];
  const byFp = new Map<string, Question>();
  for (const q of currentDoc.questions) byFp.set(q.stableFingerprint, q);

  let revalidated = 0;
  for (const step of plan.steps) {
    const q = byFp.get(step.questionFingerprint);
    if (!q) {
      errors.push({
        code: MQX.FILL_FINGERPRINT_MISMATCH,
        message: `pregunta #${step.questionNumber}: no se encuentra en la página actual`,
      });
      continue;
    }
    if (expectedKind(q) !== step.kind) {
      errors.push({
        code: MQX.FILL_FINGERPRINT_MISMATCH,
        message: `pregunta #${step.questionNumber}: el tipo cambió (${step.kind} → ${q.kind})`,
      });
      continue;
    }
    if ((step.kind === 'radio' || step.kind === 'checkbox' || step.kind === 'select') &&
        Array.isArray(step.value)) {
      const available = new Set(q.choices.map((c) => c.letter.toLowerCase()));
      const missing = (step.value as ReadonlyArray<string>).filter((l) => !available.has(l));
      if (missing.length > 0) {
        warnings.push({
          code: MQX.FILL_FINGERPRINT_MISMATCH,
          message: `pregunta #${step.questionNumber}: letra(s) reordenada(s) por Moodle, faltan: ${missing.join(', ')}`,
        });
      }
    }
    revalidated += 1;
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    result: {
      plan,
      warnings: [...plan.warnings, ...warnings],
      revalidated,
    },
  };
}

function expectedKind(q: Question): 'radio' | 'checkbox' | 'short_text' | 'long_text' | 'select' {
  switch (q.kind) {
    case 'single_choice':
      return 'radio';
    case 'multiple_choice':
      return 'checkbox';
    case 'short_text':
      return 'short_text';
    case 'long_text':
      return 'long_text';
    case 'select':
      return 'select';
    case 'unsupported':
      // Unsupported never reaches this path (apply-plan rejects upfront),
      // but the type checker wants exhaustiveness.
      throw new Error(`unexpected unsupported question in validatePlan: ${q.number}`);
  }
}