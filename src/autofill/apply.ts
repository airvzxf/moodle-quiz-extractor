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
  const report: ApplyReport = { applied: [], failed: [] };
  for (const step of plan.steps) {
    const wanted = [
      ...step.check.map((id) => ({ id, checked: true })),
      ...step.uncheck.map((id) => ({ id, checked: false })),
    ];
    const targets = wanted.map((w) => ({ ...w, input: doc.getElementById(w.id) }));
    const allPresent = targets.every((t) => isChoiceInput(t.input));
    if (!allPresent) {
      report.failed.push({ number: step.number, reason: 'missing-input' });
      continue;
    }
    for (const t of targets) {
      const input = t.input as HTMLInputElement;
      if (input.checked !== t.checked) input.click();
    }
    const confirmed = targets.every((t) => (t.input as HTMLInputElement).checked === t.checked);
    if (confirmed) report.applied.push(step.number);
    else report.failed.push({ number: step.number, reason: 'not-confirmed' });
  }
  return report;
}

// tagName en lugar de instanceof: en Firefox los content scripts ven los nodos
// a través de envoltorios Xray y instanceof entre mundos no es fiable.
function isChoiceInput(el: Element | null): boolean {
  if (el === null || el.tagName !== 'INPUT') return false;
  const type = (el as HTMLInputElement).type;
  return type === 'radio' || type === 'checkbox';
}
