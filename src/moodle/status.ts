import type { PageStatus } from '@/domain/types';
import { parseAttemptPage, questionSelector, quizPageKind } from '@/moodle/parse-page';

/**
 * Clasifica la pestaña:
 * - 'login' si hay un formulario de acceso (form#login o input[name=password]);
 * - 'attempt' si la URL es /mod/quiz/attempt.php y existe form#responseform con
 *   al menos un div.que;
 * - 'review' si la URL es /mod/quiz/review.php y #region-main tiene algún div.que;
 * - 'not-attempt' en cualquier otro caso.
 */
export function readStatus(doc: Document, url: string): PageStatus {
  if (doc.querySelector('form#login, input[name="password"]')) return { kind: 'login' };
  const kind = quizPageKind(url);
  if (kind === null || !doc.querySelector(questionSelector(kind))) {
    return { kind: 'not-attempt' };
  }
  const page = parseAttemptPage(doc, url);
  if (kind === 'review') {
    const total = page.navigation.entries.length || page.questions.length;
    return { kind: 'review', title: page.title, total };
  }
  const { navigation } = page;
  const onPage = page.questions.map((q) => q.number);
  return {
    kind: 'attempt',
    title: page.title,
    currentPage: navigation.currentPage,
    pages: navigation.pages,
    mode: navigation.mode,
    onPage,
    total: navigation.entries.length > 0 ? navigation.entries.length : onPage.length,
  };
}
