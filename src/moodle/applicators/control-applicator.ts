// src/moodle/applicators/control-applicator.ts
//
// Per-step DOM mutators for the autofill flow. Each apply function:
//   1. Locates the right control on the page.
//   2. Sets the value / clicks the radio.
//   3. Dispatches the input/change events Moodle listens for.
//   4. Verifies the post-condition (the value actually changed).
//
// All functions are total: failures return a typed ApplyError so the
// job machine can decide whether to retry or abort. The caller is
// expected to have already installed the no-submit spy (form + fetch)
// before invoking these.

import type { ApplyStep, ApplyStepKind } from '~/autofill/apply-plan';
import { MQX } from '~/diagnostics/codes';

export type ApplyErrorCode =
  | 'MQX-FILL-301'
  | 'MQX-FILL-302'
  | 'MQX-FILL-303'
  | 'MQX-FILL-305';

export interface ApplyError {
  readonly code: string;
  readonly message: string;
  readonly questionFingerprint: string;
  readonly questionNumber: number;
  readonly sourceLine: number;
}

export type ApplyResult =
  | { ok: true }
  | { ok: false; error: ApplyError };

export interface ApplyStepContext {
  /** Question root element (the .que div). */
  readonly root: HTMLElement;
  readonly step: ApplyStep;
}

const LETTERS_PATTERN = /^[a-z]$/;

export function applyStep(ctx: ApplyStepContext): ApplyResult {
  switch (ctx.step.kind) {
    case 'radio':
      return applyRadio(ctx);
    case 'checkbox':
      return applyCheckbox(ctx);
    case 'short_text':
      return applyShortText(ctx);
    case 'long_text':
      return applyLongText(ctx);
    case 'select':
      return applySelect(ctx);
  }
}

function applyRadio(ctx: ApplyStepContext): ApplyResult {
  const letters = collectLetters(ctx.step);
  if (letters.length !== 1) {
    return failure(ctx.step, MQX.FILL_LETTER_NOT_FOUND, 'radio requiere exactamente una letra');
  }
  const letter = letters[0]!;
  const input = findInputByLetter(ctx.root, 'radio', letter);
  if (!input) {
    return failure(ctx.step, MQX.FILL_LETTER_NOT_FOUND, `radio con letra "${letter}" no encontrado`);
  }
  if (input.disabled) {
    return failure(ctx.step, MQX.FILL_LETTER_NOT_FOUND, `radio con letra "${letter}" está deshabilitado`);
  }
  input.click();
  if (!input.checked) {
    return failure(ctx.step, MQX.FILL_CONTROL_NOT_CONFIRMED, `radio con letra "${letter}" no quedó marcado`);
  }
  return { ok: true };
}

function applyCheckbox(ctx: ApplyStepContext): ApplyResult {
  const letters = collectLetters(ctx.step);
  if (letters.length === 0) {
    return failure(ctx.step, MQX.FILL_LETTER_NOT_FOUND, 'checkbox requiere al menos una letra');
  }
  for (const letter of letters) {
    const input = findInputByLetter(ctx.root, 'checkbox', letter);
    if (!input) {
      return failure(ctx.step, MQX.FILL_LETTER_NOT_FOUND, `checkbox con letra "${letter}" no encontrado`);
    }
    input.click();
    if (!input.checked) {
      return failure(ctx.step, MQX.FILL_CONTROL_NOT_CONFIRMED, `checkbox con letra "${letter}" no quedó marcado`);
    }
  }
  return { ok: true };
}

function applyShortText(ctx: ApplyStepContext): ApplyResult {
  const text = typeof ctx.step.value === 'string' ? ctx.step.value : ctx.step.value.join('');
  const input = findTextInput(ctx.root);
  if (!input) {
    return failure(ctx.step, MQX.FILL_LETTER_NOT_FOUND, 'short_text: no se encontró <input type=text>');
  }
  setInputValue(input, text);
  dispatchInputEvents(input);
  if (input.value !== text) {
    return failure(ctx.step, MQX.FILL_CONTROL_NOT_CONFIRMED, 'short_text: el valor no se confirmó');
  }
  return { ok: true };
}

function applyLongText(ctx: ApplyStepContext): ApplyResult {
  const text = typeof ctx.step.value === 'string' ? ctx.step.value : ctx.step.value.join('');
  const area = findTextarea(ctx.root);
  if (!area) {
    return failure(ctx.step, MQX.FILL_LETTER_NOT_FOUND, 'long_text: no se encontró <textarea>');
  }
  setInputValue(area, text);
  dispatchInputEvents(area);
  if (area.value !== text) {
    return failure(ctx.step, MQX.FILL_CONTROL_NOT_CONFIRMED, 'long_text: el valor no se confirmó');
  }
  return { ok: true };
}

function applySelect(ctx: ApplyStepContext): ApplyResult {
  const letters = collectLetters(ctx.step);
  if (letters.length !== 1) {
    return failure(ctx.step, MQX.FILL_LETTER_NOT_FOUND, 'select requiere exactamente una letra');
  }
  const letter = letters[0]!;
  const select = findSelect(ctx.root);
  if (!select) {
    return failure(ctx.step, MQX.FILL_LETTER_NOT_FOUND, 'select: no se encontró <select>');
  }
  const options = Array.from(select.querySelectorAll('option'));
  const target = options.find((o) => {
    const text = (o.textContent ?? '').replace(/\s+/g, ' ').trim();
    const m = text.match(/^([a-zA-Z])[\.\)\]]/);
    const optionLetter = m ? m[1]!.toLowerCase() : null;
    return optionLetter === letter;
  });
  if (!target) {
    return failure(ctx.step, MQX.FILL_LETTER_NOT_FOUND, `select: opción con letra "${letter}" no encontrada`);
  }
  select.value = target.value;
  dispatchInputEvents(select);
  if (select.value !== target.value) {
    return failure(ctx.step, MQX.FILL_CONTROL_NOT_CONFIRMED, 'select: el valor no se confirmó');
  }
  return { ok: true };
}

// --- DOM helpers ---------------------------------------------------------

function collectLetters(step: ApplyStep): string[] {
  if (Array.isArray(step.value)) return step.value.map((l) => l.toLowerCase());
  return [];
}

function findInputByLetter(root: HTMLElement, kind: 'radio' | 'checkbox', letter: string): HTMLInputElement | null {
  if (!LETTERS_PATTERN.test(letter)) return null;
  const answer = root.querySelector('.answer');
  const scope: ParentNode = answer ?? root;
  const inputs = Array.from(scope.querySelectorAll<HTMLInputElement>(`input[type=${kind}]`));
  return inputs.find((input) => {
    if (input.disabled) return false;
    if (input.type === 'hidden') return false;
    // Walk up to the .r0/.r1 container, then read its .answernumber.
    const row = input.closest('.answer, .r0, .r1');
    if (!row) return false;
    const span = row.querySelector('.answernumber');
    if (!span) return false;
    const txt = (span.textContent ?? '').replace(/[.)\]]/g, '').trim();
    return txt.toLowerCase() === letter;
  }) ?? null;
}

function findTextInput(root: HTMLElement): HTMLInputElement | null {
  const answer = root.querySelector('.answer');
  const scope: ParentNode = answer ?? root;
  const inputs = Array.from(scope.querySelectorAll<HTMLInputElement>('input[type=text]'));
  return inputs.find((i) => !i.disabled && i.type !== 'hidden') ?? null;
}

function findTextarea(root: HTMLElement): HTMLTextAreaElement | null {
  const answer = root.querySelector('.answer');
  const scope: ParentNode = answer ?? root;
  const areas = Array.from(scope.querySelectorAll<HTMLTextAreaElement>('textarea'));
  return areas.find((t) => !t.disabled) ?? null;
}

function findSelect(root: HTMLElement): HTMLSelectElement | null {
  const answer = root.querySelector('.answer');
  const scope: ParentNode = answer ?? root;
  const sel = scope.querySelector('select');
  if (!sel || sel.tagName !== 'SELECT') return null;
  if ('disabled' in sel && sel.disabled) return null;
  return sel as HTMLSelectElement;
}

function setInputValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  // Use the native value setter so React/Moodle listeners see the
  // change as a real user input (and not a synthetic assignment).
  const proto = Object.getPrototypeOf(el) as { __lookupSetter__?: (k: string) => unknown };
  const setter = proto.__lookupSetter__
    ? (proto.__lookupSetter__('value') as ((v: string) => void) | undefined)
    : undefined;
  if (setter) {
    setter.call(el, value);
  } else {
    el.value = value;
  }
}

function dispatchInputEvents(el: HTMLElement): void {
  // Moodle binds jQuery change/input handlers; dispatch the bare
  // events in case jQuery is not loaded (or in case it uses native).
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function failure(step: ApplyStep, code: typeof MQX.FILL_LETTER_NOT_FOUND | typeof MQX.FILL_LETTER_NOT_FOUND | typeof MQX.FILL_CONTROL_NOT_CONFIRMED, message: string): ApplyResult {
  return {
    ok: false,
    error: {
      code,
      message,
      questionFingerprint: step.questionFingerprint,
      questionNumber: step.questionNumber,
      sourceLine: step.sourceLine,
    },
  };
}

// Suppress unused import warning for ApplyStepKind (kept for downstream
// consumers that re-export the union).
void ({} as ApplyStepKind);