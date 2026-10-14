import type { Choice, Question, QuestionOutcome, QuizDocument, QuizImage } from '@/domain/types';
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

const OUTCOME_SYMBOL: Record<QuestionOutcome, string> = {
  correct: '✅',
  partial: '◐',
  incorrect: '❌',
  unanswered: '➖',
};

/** [singular, plural] para el recuento del resultado de la revisión. */
const OUTCOME_COUNT: Record<QuestionOutcome, [string, string]> = {
  correct: ['correcta', 'correctas'],
  partial: ['parcialmente correcta', 'parcialmente correctas'],
  incorrect: ['incorrecta', 'incorrectas'],
  unanswered: ['sin contestar', 'sin contestar'],
};

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
 * Revisión (review.php, D26, issue #11): el título lleva « — Revisión»; tras
 * el contexto van el resumen de Moodle como lista y un recuento
 * («**Resultado:** ✅ 2 correctas · ◐ 1 parcialmente correcta…»); cada pregunta
 * lleva « — <símbolo> <estado> (<obtenido>/<máximo>)» en el título, las
 * opciones elegidas siempre como «- [x]» con ✅/❌/◐, y debajo, si Moodle las
 * muestra, «Respuesta correcta», «Retroalimentación» y «Retroalimentación
 * general».
 *
 * El texto que viene de Moodle se escapa para que no se interprete como
 * Markdown ni HTML. Cada dato va en su propia línea de lista o párrafo: nunca
 * dos líneas seguidas que el renderizador junte en un párrafo.
 */
export function renderMarkdown(doc: QuizDocument, opts: MarkdownOptions): string {
  const review = doc.kind === 'review';
  const title = escapeText(doc.title) || 'Cuestionario Moodle';
  const head = [review ? `# ${title} — Revisión` : `# ${title}`];

  const context: string[] = [];
  if (doc.course) context.push(`**Curso:** ${escapeText(doc.course)}`);
  if (doc.unit) context.push(`**Unidad:** ${escapeText(doc.unit)}`);
  if (doc.section && doc.section !== doc.title) context.push(`**Sección:** ${escapeText(doc.section)}`);
  if (context.length > 0) head.push(context.join(' · '));
  if (review) {
    if (doc.summary.length > 0) {
      head.push(doc.summary.map((r) => `- ${keyValue(escapeText(r.label), escapeText(r.value))}`).join('\n'));
    }
    const counts = (Object.keys(OUTCOME_COUNT) as QuestionOutcome[])
      .map((o) => [o, doc.questions.filter((q) => q.outcome === o).length] as const)
      .filter(([, n]) => n > 0)
      .map(([o, n]) => `${OUTCOME_SYMBOL[o]} ${n} ${OUTCOME_COUNT[o][n === 1 ? 0 : 1]}`);
    if (counts.length > 0) head.push(`**Resultado:** ${counts.join(' · ')}`);
  }

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
      ? doc.questions.map((q) => renderQuestion(q, opts, review)).join(SEPARATOR)
      : '_Sin preguntas._';
  const footer = `\n\n> Generado por moodle-quiz-extractor v${opts.generatorVersion} — ${opts.exportedAt}\n`;
  return `${head.join('\n\n')}${SEPARATOR}${body}${footer}`;
}

function renderQuestion(q: Question, opts: MarkdownOptions, review: boolean): string {
  const blocks = [`### ${q.number}. ${escapeText(q.text)}${review ? reviewHeading(q) : ''}`];
  for (const image of q.images) blocks.push(imageMarkdown(image, opts));
  if (q.kind === 'unsupported') {
    blocks.push('_No se reconocen opciones para este tipo de pregunta._');
  } else {
    const prompt = q.kind === 'multiple_choice' ? 'Selecciona una o más opciones:' : 'Selecciona una opción:';
    blocks.push([prompt, ...q.choices.map((c) => renderChoice(c, opts, review))].join('\n'));
  }
  if (review) {
    const result: string[] = [];
    if (q.rightAnswer !== null) result.push(keyValue('Respuesta correcta', escapeText(afterLabel(q.rightAnswer))));
    const feedback = q.choices.filter((c) => c.selected && c.feedback !== null).map((c) => c.feedback!);
    if (feedback.length > 0) result.push(keyValue('Retroalimentación', escapeText(feedback.join(' '))));
    if (q.generalFeedback !== null) result.push(keyValue('Retroalimentación general', escapeText(q.generalFeedback)));
    if (result.length > 0) blocks.push(result.map((r) => `- ${r}`).join('\n'));
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

function renderChoice(c: Choice, opts: MarkdownOptions, review: boolean): string {
  // En la revisión lo elegido es el contenido principal: siempre se marca.
  const mark = (review || opts.detailed) && c.selected ? 'x' : ' ';
  const symbol = review && c.selected && c.outcome !== null ? OUTCOME_SYMBOL[c.outcome] : '';
  const label = [escapeText(c.text), ...c.images.map((i) => imageMarkdown(i, opts)), symbol]
    .filter((p) => p !== '')
    .join(' ');
  return label ? `- [${mark}] ${c.letter}. ${label}` : `- [${mark}] ${c.letter}.`;
}

/** « — ✅ Correcta (10.00/10.00)» a partir del resultado, el estado y el puntaje de Moodle. */
function reviewHeading(q: Question): string {
  const parts = [q.outcome ? OUTCOME_SYMBOL[q.outcome] : '', q.state ? escapeText(q.state) : ''].filter((p) => p !== '');
  const numbers = q.grade?.match(/\d+(?:[.,]\d+)?/g) ?? [];
  if (numbers.length >= 2) parts.push(`(${numbers[0]}/${numbers[1]})`);
  else if (numbers.length === 1) parts.push(`(—/${numbers[0]})`);
  return parts.length > 0 ? ` — ${parts.join(' ')}` : '';
}

/** "La respuesta correcta es: Linux" → "Linux"; sin «: », el texto entero. */
function afterLabel(text: string): string {
  const i = text.indexOf(': ');
  return i > 0 && i < 60 ? text.slice(i + 2) : text;
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
