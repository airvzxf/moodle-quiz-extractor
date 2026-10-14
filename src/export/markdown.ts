import type { Choice, Question, QuizDocument, QuizImage } from '@/domain/types';
import { describeWarning } from '@/shared/messages';

export interface MarkdownOptions {
  /** Modo detallado: añade metadatos técnicos y marca con - [x] lo seleccionado. */
  detailed: boolean;
  generatorVersion: string;
  /** Fecha ISO 8601 que se escribe en el pie (y en el encabezado si es detallado). */
  exportedAt: string;
  /** url → ruta dentro de la carpeta del ZIP ("quiz/x.png"). Sin entrada: se enlaza la URL. */
  imagePaths: ReadonlyMap<string, string>;
}

const SEPARATOR = '\n\n---\n\n';

const KIND_LABEL: Record<Question['kind'], string> = {
  single_choice: 'opción única',
  multiple_choice: 'opción múltiple',
  unsupported: 'no soportado',
};

/**
 * Markdown del cuestionario pensado para verse bien al renderizarse
 * (GitHub, Obsidian, VS Code). Formato (D25, issue #14):
 *
 *   # <título>                         ("Cuestionario Moodle" si no hay)
 *   **Curso:** … · **Unidad:** … · **Sección:** …   (sólo lo que exista; la
 *                                       sección se omite si es igual al título)
 *   <details> "Datos del cuestionario"   (sólo detallado: origen, intento,
 *                                       cmid, navegación, páginas, total,
 *                                       fecha y un "Aviso" por advertencia)
 *   ---                                (antes de cada pregunta)
 *   ### <n>. <enunciado>
 *   ![alt](ruta)                       (una por imagen, en su propio párrafo)
 *   Selecciona una opción: | Selecciona una o más opciones:
 *   - [ ] <letra>. <texto> ![alt](ruta)   ("- [x]" si está marcada y es detallado)
 *   <details><summary>Datos</summary>  (lista: tipo, puntaje y estado de
 *                                       Moodle; en detallado también tipo
 *                                       Moodle, página, instrucción e imágenes)
 *   > Generado por moodle-quiz-extractor v<versión> — <fecha>
 *
 * El texto que viene de Moodle se escapa para que no se interprete como
 * Markdown ni HTML. Cada dato va en su propia línea de lista o párrafo: nunca
 * dos líneas seguidas que el renderizador junte en un párrafo.
 */
export function renderMarkdown(doc: QuizDocument, opts: MarkdownOptions): string {
  const head = [`# ${escapeText(doc.title) || 'Cuestionario Moodle'}`];

  const context: string[] = [];
  if (doc.course) context.push(`**Curso:** ${escapeText(doc.course)}`);
  if (doc.unit) context.push(`**Unidad:** ${escapeText(doc.unit)}`);
  if (doc.section && doc.section !== doc.title) context.push(`**Sección:** ${escapeText(doc.section)}`);
  if (context.length > 0) head.push(context.join(' · '));

  if (opts.detailed) {
    const data = [keyValue('Origen', autolink(`${doc.source.origin}${doc.source.path}`))];
    if (doc.source.attemptId !== null) data.push(keyValue('Intento', String(doc.source.attemptId)));
    if (doc.source.cmid !== null) data.push(keyValue('Módulo (cmid)', String(doc.source.cmid)));
    data.push(keyValue('Navegación', doc.navigation === 'free' ? 'libre' : 'secuencial'));
    data.push(keyValue('Páginas exportadas', doc.pages.map((p) => p + 1).join(', ')));
    data.push(keyValue('Total de preguntas', String(doc.questions.length)));
    data.push(keyValue('Exportado', opts.exportedAt));
    for (const w of doc.warnings) data.push(keyValue('Aviso', escapeText(describeWarning(w))));
    head.push(details('Datos del cuestionario', data));
  }

  const body =
    doc.questions.length > 0
      ? doc.questions.map((q) => renderQuestion(q, opts)).join(SEPARATOR)
      : '_Sin preguntas._';
  const footer = `\n\n> Generado por moodle-quiz-extractor v${opts.generatorVersion} — ${opts.exportedAt}\n`;
  return `${head.join('\n\n')}${SEPARATOR}${body}${footer}`;
}

function renderQuestion(q: Question, opts: MarkdownOptions): string {
  const blocks = [`### ${q.number}. ${escapeText(q.text)}`];
  for (const image of q.images) blocks.push(imageMarkdown(image, opts));
  if (q.kind === 'unsupported') {
    blocks.push('_No se reconocen opciones para este tipo de pregunta._');
  } else {
    const prompt = q.kind === 'multiple_choice' ? 'Selecciona una o más opciones:' : 'Selecciona una opción:';
    blocks.push([prompt, ...q.choices.map((c) => renderChoice(c, opts))].join('\n'));
  }

  const data = [keyValue('Tipo', KIND_LABEL[q.kind])];
  if (q.grade !== null) data.push(escapeText(q.grade));
  if (q.state !== null) data.push(escapeText(q.state));
  if (opts.detailed) {
    data.push(keyValue('Tipo Moodle', escapeText(q.moodleType)));
    data.push(keyValue('Página', String(q.page + 1)));
    if (q.instruction !== null) data.push(keyValue('Instrucción', escapeText(q.instruction)));
    for (const image of [...q.images, ...q.choices.flatMap((c) => c.images)]) {
      data.push(keyValue('Imagen', `${escapeText(image.alt || '(sin texto alternativo)')} — ${autolink(image.url)}`));
    }
  }
  blocks.push(details('Datos', data));
  return blocks.join('\n\n');
}

function renderChoice(c: Choice, opts: MarkdownOptions): string {
  const mark = opts.detailed && c.selected ? 'x' : ' ';
  const label = [escapeText(c.text), ...c.images.map((i) => imageMarkdown(i, opts))].filter((p) => p !== '').join(' ');
  return label ? `- [${mark}] ${c.letter}. ${label}` : `- [${mark}] ${c.letter}.`;
}

/** Bloque plegable; las líneas en blanco permiten Markdown dentro del HTML. */
function details(summary: string, items: string[]): string {
  return `<details><summary>${summary}</summary>\n\n${items.map((i) => `- ${i}`).join('\n')}\n\n</details>`;
}

/** "**Clave:** valor". `value` ya debe venir escapado o ser Markdown propio. */
function keyValue(key: string, value: string): string {
  return `**${key}:** ${value}`;
}

/** Autoenlace CommonMark: la URL no necesita escaparse. */
function autolink(url: string): string {
  return `<${url.replace(/[\s<>]/g, encodeURIComponent)}>`;
}

function imageMarkdown(image: QuizImage, opts: MarkdownOptions): string {
  const path = opts.imagePaths.get(image.url);
  const target = path ? `./${path}` : image.url;
  const alt = image.alt.replace(/[\\[\]]/g, '\\$&');
  return `![${alt}](${/[\s()<>]/.test(target) ? `<${target}>` : target})`;
}

/** Escapa lo que CommonMark/GFM interpretaría en texto de Moodle. */
function escapeText(text: string): string {
  return text.replace(/[\\`*_[\]<>~]/g, '\\$&');
}
