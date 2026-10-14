import type { ApplyReport, FillPlan } from '@/autofill/types';

/**
 * Aplica el plan en la página como lo haría una persona: para cada id de
 * `check` y `uncheck`, si el estado `checked` no es el deseado, llama a
 * `input.click()` (dispara click/input/change nativos). Nunca envía el
 * formulario ni pulsa botones.
 * Por paso, en orden:
 * - si falta algún <input> (getElementById) o no es radio/checkbox → failed 'missing-input', sin tocar nada;
 * - si tras los clics algún control no quedó como se pidió → failed 'not-confirmed';
 * - si no, el número va a `applied`.
 */
export function applyFillPlan(doc: Document, plan: FillPlan): ApplyReport {
  throw new Error('not implemented');
}
