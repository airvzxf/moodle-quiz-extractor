import type { ExportWarning, ParsedPage, Question, QuizDocument } from '@/domain/types';
import { parseAttemptPage, readNavigation } from '@/moodle/parse-page';

/** Carga una página del intento (GET con la sesión de la persona) como Document. */
export type LoadPage = (url: string) => Promise<Document>;

/** URL de la página `page` del mismo intento: fija `page` y quita el fragmento. */
export function pageUrl(currentUrl: string, page: number): string {
  throw new Error('not implemented');
}

/**
 * Reúne el cuestionario completo a partir de la página actual.
 * - Navegación 'free' con varias páginas: carga las demás páginas EN ORDEN
 *   ascendente con `loadPage(pageUrl(currentUrl, n))`, una a la vez. Una página
 *   se acepta sólo si tiene form#responseform y su `thispage` es n; si no (o si
 *   loadPage lanza), se añade el aviso {code:'page-unavailable', detail:String(n)}.
 * - Navegación 'sequential' con varias páginas: no carga nada y añade
 *   {code:'sequential-navigation', detail:String(currentPage)}.
 * - Cada pregunta 'unsupported' añade {code:'unsupported-question', detail:String(number)}.
 * Orden de avisos: navegación/páginas primero (por página), luego preguntas (por número).
 * Las preguntas se ordenan por número; un número repetido conserva la primera.
 */
export async function collectQuiz(
  current: ParsedPage,
  currentUrl: string,
  loadPage: LoadPage,
): Promise<QuizDocument> {
  throw new Error('not implemented');
}
