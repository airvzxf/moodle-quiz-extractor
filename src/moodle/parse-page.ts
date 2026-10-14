import type {
  Choice,
  Navigation,
  NavEntry,
  ParsedPage,
  Question,
  QuestionKind,
  QuizImage,
} from '@/domain/types';
import { cleanUrl, normalizeSpace } from '@/shared/text';

/** true si la ruta de `url` termina en /mod/quiz/attempt.php. */
export function isAttemptUrl(url: string): boolean {
  throw new Error('not implemented');
}

/**
 * Lee el bloque de navegación (`a.qnbutton[data-quiz-page]`).
 * - Botones sin número (bloques de información "i") se ignoran.
 * - Sin botones numerados: entries = [], pages = [currentPage], mode = 'sequential'.
 */
export function readNavigation(doc: Document): Navigation {
  throw new Error('not implemented');
}

/**
 * Lee una página de intento ya cargada. `pageUrl` es la URL con la que se
 * obtuvo el documento: se usa para resolver imágenes relativas y para leer
 * `attempt` y `cmid`. Sólo se leen las preguntas dentro de #responseform.
 */
export function parseAttemptPage(doc: Document, pageUrl: string): ParsedPage {
  throw new Error('not implemented');
}
