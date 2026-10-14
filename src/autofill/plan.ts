import type { AnswerEntry, FillIssue, FillPlan, FillStep } from '@/autofill/types';
import type { ParsedPage } from '@/domain/types';

/**
 * Decide qué hacer con cada respuesta respecto a la página actual.
 * Para cada entrada (en orden de número):
 * - Pregunta en esta página:
 *   - kind 'unsupported'                         → issue 'unsupported'
 *   - alguna letra que no existe                 → issue 'unknown-letter' (letter = la primera)
 *   - single_choice con más de una letra         → issue 'too-many-letters'
 *   - single_choice                              → step {check:[id], uncheck:[]}
 *   - multiple_choice                            → step {check: ids de las letras,
 *                                                   uncheck: ids del resto}, ambos en orden de opciones
 * - No está en esta página pero sí en la navegación → issue 'other-page' (page)
 * - En ningún sitio                                → issue 'not-in-quiz'
 */
export function buildFillPlan(entries: AnswerEntry[], page: ParsedPage): FillPlan {
  const steps: FillStep[] = [];
  const issues: FillIssue[] = [];
  const onPage = new Map(page.questions.map((q) => [q.number, q]));
  const navPage = new Map(page.navigation.entries.map((e) => [e.number, e.page]));

  for (const entry of [...entries].sort((a, b) => a.number - b.number)) {
    const { number } = entry;
    const q = onPage.get(number);
    if (!q) {
      const other = navPage.get(number);
      issues.push(other === undefined ? { number, reason: 'not-in-quiz' } : { number, reason: 'other-page', page: other });
      continue;
    }
    if (q.kind === 'unsupported') {
      issues.push({ number, reason: 'unsupported' });
      continue;
    }
    const letters = new Set(q.choices.map((c) => c.letter));
    const unknown = entry.letters.find((l) => !letters.has(l));
    if (unknown !== undefined) {
      issues.push({ number, reason: 'unknown-letter', letter: unknown });
      continue;
    }
    if (q.kind === 'single_choice') {
      if (entry.letters.length > 1) {
        issues.push({ number, reason: 'too-many-letters' });
        continue;
      }
      const choice = q.choices.find((c) => c.letter === entry.letters[0]);
      steps.push({ number, kind: 'single_choice', check: choice ? [choice.inputId] : [], uncheck: [] });
      continue;
    }
    const wanted = new Set(entry.letters);
    steps.push({
      number,
      kind: 'multiple_choice',
      check: q.choices.filter((c) => wanted.has(c.letter)).map((c) => c.inputId),
      uncheck: q.choices.filter((c) => !wanted.has(c.letter)).map((c) => c.inputId),
    });
  }
  return { steps, issues };
}
