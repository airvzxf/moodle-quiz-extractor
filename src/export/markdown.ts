import type { Choice, Question, QuizDocument, QuizImage } from '@/domain/types';
import { describeWarning } from '@/shared/messages';

export interface MarkdownOptions {
  /** Modo detallado: añade metadatos técnicos y marca con [x] lo seleccionado. */
  detailed: boolean;
  generatorVersion: string;
  /** Fecha ISO 8601 que se escribe en el pie (y en el encabezado si es detallado). */
  exportedAt: string;
  /** url → ruta dentro de la carpeta del ZIP ("quiz/x.png"). Sin entrada: se enlaza la URL. */
  imagePaths: ReadonlyMap<string, string>;
}

const SEPARATOR = '\n\n---\n\n';

/**
 * Markdown legible del cuestionario. Formato por defecto (contrato heredado):
 *
 *   # <curso> | <unidad>            ("# <curso>" sin unidad; "Cuestionario Moodle" sin curso)
 *   (línea vacía)
 *   ## <título>
 *   (línea vacía)
 *   Metadata
 *   Desconocido: <sección|unidad|título con espacios cambiados por '_'>
 *   ---  (separador "\n\n---\n\n" antes de cada pregunta y entre preguntas)
 *   ### <n>. <enunciado>
 *   [IMAGEN](<ruta>)                 (una línea por imagen del enunciado)
 *   #### Respuestas
 *   Selecciona una opción:            (single_choice)
 *   Selecciona una o mas opción:      (multiple_choice)
 *   [ ] <letra>. <texto>.             (una por opción)
 *   (línea vacía)
 *   Metadata
 *   Tipo de respuesta: <kind>.
 *   <puntaje>                         (si existe)
 *   <estado>                          (si existe)
 *
 * El documento termina con "\n\n> Generado por moodle-quiz-extractor v<versión> — <fecha>\n".
 * Ver docs del plan (02-contract.md) para el modo detallado y los casos límite.
 */
export function renderMarkdown(doc: QuizDocument, opts: MarkdownOptions): string {
  throw new Error('not implemented');
}
