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
  throw new Error('not implemented');
}
