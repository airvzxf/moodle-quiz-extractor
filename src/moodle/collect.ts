import type { ExportWarning, ParsedPage, Question, QuizDocument } from '@/domain/types';
import { parseAttemptPage, questionSelector, readNavigation } from '@/moodle/parse-page';

/** Carga una página del intento (GET con la sesión de la persona) como Document. */
export type LoadPage = (url: string) => Promise<Document>;

/** URL de la página `page` del mismo intento: fija `page` y quita el fragmento. */
export function pageUrl(currentUrl: string, page: number): string {
  const url = new URL(currentUrl);
  url.searchParams.set('page', String(page));
  url.hash = '';
  return url.toString();
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
 * - Revisión (review.php): si faltan preguntas de la navegación en la página
 *   actual, carga UNA vez la versión con todas (`showAllUrl`); si falla, añade
 *   'page-unavailable' por cada página de la que falten preguntas.
 * Orden de avisos: navegación/páginas primero (por página), luego preguntas (por número).
 * Las preguntas se ordenan por número; un número repetido conserva la primera.
 */
/** URL de la revisión con todas las preguntas en una página (showall=1, sin page). */
export function showAllUrl(currentUrl: string): string {
  const url = new URL(currentUrl);
  url.searchParams.delete('page');
  url.searchParams.set('showall', '1');
  url.hash = '';
  return url.toString();
}

export async function collectQuiz(
  current: ParsedPage,
  currentUrl: string,
  loadPage: LoadPage,
): Promise<QuizDocument> {
  const { navigation } = current;
  const warnings: ExportWarning[] = [];
  const parsed: ParsedPage[] = [current];
  const included = [navigation.currentPage];

  if (current.kind === 'review') {
    const shown = new Set(current.questions.map((q) => q.number));
    const missing = navigation.entries.filter((e) => !shown.has(e.number));
    if (missing.length > 0) {
      const url = showAllUrl(currentUrl);
      try {
        const doc = await loadPage(url);
        if (!doc.querySelector(questionSelector('review'))) throw new Error('unexpected page');
        parsed.splice(0, parsed.length, parseAttemptPage(doc, url));
        included.splice(0, included.length, ...navigation.pages);
      } catch {
        for (const page of new Set(missing.map((e) => e.page))) {
          warnings.push({ code: 'page-unavailable', detail: String(page) });
        }
      }
    }
  } else if (navigation.pages.length > 1 && navigation.mode === 'sequential') {
    warnings.push({ code: 'sequential-navigation', detail: String(navigation.currentPage) });
  } else if (navigation.pages.length > 1) {
    for (const page of navigation.pages) {
      if (page === navigation.currentPage) continue;
      const url = pageUrl(currentUrl, page);
      try {
        const doc = await loadPage(url);
        const ok =
          doc.querySelector('form#responseform') !== null &&
          readNavigation(doc).currentPage === page;
        if (!ok) throw new Error('unexpected page');
        parsed.push(parseAttemptPage(doc, url));
        included.push(page);
      } catch {
        warnings.push({ code: 'page-unavailable', detail: String(page) });
      }
    }
  }

  const byNumber = new Map<number, Question>();
  for (const p of parsed) {
    for (const q of p.questions) if (!byNumber.has(q.number)) byNumber.set(q.number, q);
  }
  const questions = [...byNumber.values()].sort((a, b) => a.number - b.number);
  for (const q of questions) {
    if (q.kind === 'unsupported') {
      warnings.push({ code: 'unsupported-question', detail: String(q.number) });
    }
  }

  const url = new URL(currentUrl);
  return {
    schemaVersion: 2,
    kind: current.kind,
    summary: current.summary,
    course: current.course,
    unit: current.unit,
    title: current.title,
    section: current.section,
    source: {
      origin: url.origin,
      path: url.pathname,
      attemptId: current.attemptId,
      cmid: current.cmid,
    },
    navigation: navigation.mode,
    pages: included.sort((a, b) => a - b),
    questions,
    warnings,
  };
}
