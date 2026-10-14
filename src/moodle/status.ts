import type { PageStatus } from '@/domain/types';
import { isAttemptUrl, parseAttemptPage } from '@/moodle/parse-page';

/**
 * Clasifica la pestaña:
 * - 'login' si hay un formulario de acceso (form#login o input[name=password]);
 * - 'attempt' si la URL es /mod/quiz/attempt.php y existe form#responseform con
 *   al menos un div.que;
 * - 'not-attempt' en cualquier otro caso.
 */
export function readStatus(doc: Document, url: string): PageStatus {
  if (doc.querySelector('form#login, input[name="password"]')) return { kind: 'login' };
  if (!isAttemptUrl(url) || !doc.querySelector('form#responseform div.que')) {
    return { kind: 'not-attempt' };
  }
  const page = parseAttemptPage(doc, url);
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
