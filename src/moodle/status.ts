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
  throw new Error('not implemented');
}
