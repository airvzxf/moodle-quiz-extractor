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
  const course = doc.course ?? 'Cuestionario Moodle';
  const h1 = doc.unit ? `# ${course} | ${doc.unit}` : `# ${course}`;
  const key = (doc.section ?? doc.unit ?? doc.title).replaceAll(' ', '_');

  const meta = ['Metadata', `Desconocido: ${key}`];
  if (opts.detailed) {
    meta.push(`Origen: ${doc.source.origin}${doc.source.path}`);
    if (doc.source.attemptId !== null) meta.push(`Intento: ${doc.source.attemptId}`);
    if (doc.source.cmid !== null) meta.push(`Módulo (cmid): ${doc.source.cmid}`);
    meta.push(`Navegación: ${doc.navigation === 'free' ? 'libre' : 'secuencial'}`);
    meta.push(`Páginas exportadas: ${doc.pages.map((p) => p + 1).join(', ')}`);
    meta.push(`Total de preguntas: ${doc.questions.length}`);
    meta.push(`Exportado: ${opts.exportedAt}`);
    for (const w of doc.warnings) meta.push(`Advertencia: ${describeWarning(w)}`);
  }

  const body =
    doc.questions.length > 0
      ? doc.questions.map((q) => renderQuestion(q, opts)).join(SEPARATOR)
      : '_Sin preguntas._';
  const footer = `\n\n> Generado por moodle-quiz-extractor v${opts.generatorVersion} — ${opts.exportedAt}\n`;
  return `${h1}\n\n## ${doc.title}\n\n${meta.join('\n')}${SEPARATOR}${body}${footer}`;
}

function renderQuestion(q: Question, opts: MarkdownOptions): string {
  const lines = [`### ${q.number}. ${q.text}`];
  for (const image of q.images) lines.push(imageLink(image, opts));
  lines.push('#### Respuestas');
  if (q.kind === 'unsupported') {
    lines.push('_No se reconocen opciones para este tipo de pregunta._');
  } else {
    lines.push(q.kind === 'multiple_choice' ? 'Selecciona una o mas opción:' : 'Selecciona una opción:');
    for (const c of q.choices) lines.push(renderChoice(c, opts));
  }

  const meta = ['Metadata', `Tipo de respuesta: ${q.kind}.`];
  if (q.grade !== null) meta.push(q.grade);
  if (q.state !== null) meta.push(q.state);
  if (opts.detailed) {
    meta.push(`Tipo Moodle: ${q.moodleType}`);
    meta.push(`Página: ${q.page + 1}`);
    if (q.instruction !== null) meta.push(`Instrucción: ${q.instruction}`);
    const images = [...q.images, ...q.choices.flatMap((c) => c.images)];
    for (const image of images) {
      meta.push(`Imagen: ${image.alt || '(sin texto alternativo)'} — ${image.url}`);
    }
  }
  return `${lines.join('\n')}\n\n${meta.join('\n')}`;
}

function renderChoice(c: Choice, opts: MarkdownOptions): string {
  const mark = opts.detailed && c.selected ? 'x' : ' ';
  const parts = [c.text.replace(/\.+$/, ''), ...c.images.map((i) => imageLink(i, opts))];
  const label = parts.filter((p) => p !== '').join(' ');
  return label ? `[${mark}] ${c.letter}. ${label}.` : `[${mark}] ${c.letter}.`;
}

function imageLink(image: QuizImage, opts: MarkdownOptions): string {
  const path = opts.imagePaths.get(image.url);
  return `[IMAGEN](${path ? `./${path}` : image.url})`;
}
