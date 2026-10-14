import type {
  Choice,
  Navigation,
  NavEntry,
  ParsedPage,
  Question,
  QuestionKind,
  QuestionOutcome,
  QuizImage,
  QuizPageKind,
  ReviewRow,
} from '@/domain/types';
import { cleanUrl, normalizeSpace } from '@/shared/text';

/** true si la ruta de `url` termina en /mod/quiz/attempt.php. */
export function isAttemptUrl(url: string): boolean {
  return quizPageKind(url) === 'attempt';
}

/** true si la ruta termina en /mod/quiz/attempt.php o /mod/quiz/review.php. */
export function isQuizPageUrl(url: string): boolean {
  return quizPageKind(url) !== null;
}

/** 'attempt' (attempt.php), 'review' (review.php) o null. */
export function quizPageKind(url: string): QuizPageKind | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  if (/\/mod\/quiz\/attempt\.php$/.test(path)) return 'attempt';
  if (/\/mod\/quiz\/review\.php$/.test(path)) return 'review';
  return null;
}

/**
 * Selector de las preguntas de la página. En el intento viven en
 * form#responseform; en la revisión no hay ese formulario y van dentro de
 * #region-main (verificado con Moodle 5.3, laboratorio #12).
 */
export function questionSelector(kind: QuizPageKind): string {
  return kind === 'review' ? '#region-main div.que' : 'form#responseform div.que';
}

/**
 * Lee el bloque de navegación (`a.qnbutton[data-quiz-page]`).
 * - Botones sin número (bloques de información "i") se ignoran.
 * - Sin botones numerados: entries = [], pages = [currentPage], mode = 'sequential'.
 */
export function readNavigation(doc: Document): Navigation {
  const thispage = doc.querySelector('input[name="thispage"]')?.getAttribute('value');
  const currentPage = toInt(thispage ?? null) ?? 0;

  const byNumber = new Map<number, NavEntry>();
  let allFree = true;
  // Libre: <a class="qnbutton free">. Secuencial: Moodle pinta <span
  // class="qnbutton sequential"> (verificado con Moodle 5.3, laboratorio #12).
  for (const a of Array.from(doc.querySelectorAll('.qnbutton[data-quiz-page]'))) {
    const match = (a.textContent ?? '').match(/\d+/);
    const page = toInt(a.getAttribute('data-quiz-page'));
    if (!match || page === null) continue;
    const number = Number.parseInt(match[0], 10);
    if (!a.classList.contains('free')) allFree = false;
    if (!byNumber.has(number)) byNumber.set(number, { number, page });
  }

  const entries = [...byNumber.values()].sort((x, y) => x.number - y.number);
  const pages =
    entries.length > 0
      ? [...new Set(entries.map((e) => e.page))].sort((x, y) => x - y)
      : [currentPage];
  const mode = entries.length > 0 && allFree ? 'free' : 'sequential';
  return { entries, pages, currentPage, mode };
}

/**
 * Lee una página de intento ya cargada. `pageUrl` es la URL con la que se
 * obtuvo el documento: se usa para resolver imágenes relativas y para leer
 * `attempt` y `cmid`. Sólo se leen las preguntas de `questionSelector`: en
 * review.php además el resumen, el resultado de cada pregunta y opción, la
 * respuesta correcta y la retroalimentación (lo que Moodle muestre).
 */
export function parseAttemptPage(doc: Document, pageUrl: string): ParsedPage {
  const kind = quizPageKind(pageUrl) ?? 'attempt';
  const navigation = readNavigation(doc);
  const crumbs = Array.from(doc.querySelectorAll('ol.breadcrumb li.breadcrumb-item'))
    .map((li) => normalizeSpace(li.textContent ?? ''))
    .filter((t) => t !== '');
  const course = crumbs.length >= 2 ? (crumbs[0] ?? null) : null;
  const unit = crumbs.length >= 3 ? (crumbs[1] ?? null) : null;

  const h1 = normalizeSpace(doc.querySelector('.page-header-headings h1')?.textContent ?? '');
  const fromTitle = normalizeSpace((doc.title ?? '').split(' | ')[0] ?? '');
  const title = h1 || fromTitle || 'Cuestionario';

  const sectionText = normalizeSpace(
    doc.querySelector('h3.mod_quiz-section-heading')?.textContent ?? '',
  );

  const url = new URL(pageUrl);
  const form = doc.querySelector('form#responseform');
  const formInput = doc.querySelector('input[name="attempt"]')?.getAttribute('value') ?? null;
  const attemptId = toInt(url.searchParams.get('attempt')) ?? toInt(formInput);
  let cmid = toInt(url.searchParams.get('cmid'));
  if (cmid === null && form) {
    try {
      cmid = toInt(new URL(form.getAttribute('action') ?? '', pageUrl).searchParams.get('cmid'));
    } catch {
      cmid = null;
    }
  }

  const questions: Question[] = [];
  for (const block of Array.from(doc.querySelectorAll(questionSelector(kind)))) {
    const q = parseQuestion(block, navigation.currentPage, pageUrl);
    if (q) questions.push(q);
  }

  const summary: ReviewRow[] = [];
  if (kind === 'review') {
    for (const tr of Array.from(doc.querySelectorAll('table.quizreviewsummary tr'))) {
      const label = normalizeSpace(tr.querySelector('th')?.textContent ?? '');
      const value = normalizeSpace(tr.querySelector('td')?.textContent ?? '');
      if (label && value) summary.push({ label, value });
    }
  }

  return {
    kind,
    summary,
    course,
    unit,
    title,
    section: sectionText || null,
    attemptId,
    cmid,
    navigation,
    questions,
  };
}

function parseQuestion(block: Element, page: number, pageUrl: string): Question | null {
  const number = toInt(normalizeSpace(block.querySelector('.info .qno')?.textContent ?? ''));
  if (number === null) return null;

  const slotMatch = block.id.match(/^question-\d+-(\d+)$/);
  const slot = slotMatch?.[1] ? Number.parseInt(slotMatch[1], 10) : 0;
  const moodleType = Array.from(block.classList).find((c) => c !== 'que') ?? '';

  const qtext = block.querySelector('.qtext');
  const legend = block.querySelector('legend.prompt');
  let instruction: string | null = null;
  if (legend) {
    const copy = legend.cloneNode(true) as Element;
    // sr-only: Bootstrap 4 (Moodle ≤4.x); visually-hidden: Bootstrap 5 (Moodle 5.x).
    copy.querySelectorAll('.sr-only, .visually-hidden').forEach((el) => el.remove());
    instruction = normalizeSpace(copy.textContent ?? '') || null;
  }

  const radios = Array.from(block.querySelectorAll<HTMLInputElement>('.answer input[type="radio"]'));
  const boxes = Array.from(block.querySelectorAll<HTMLInputElement>('.answer input[type="checkbox"]'));
  let kind: QuestionKind = 'unsupported';
  let inputs: HTMLInputElement[] = [];
  if (radios.length > 0 && boxes.length === 0) {
    kind = 'single_choice';
    inputs = radios;
  } else if (boxes.length > 0 && radios.length === 0) {
    kind = 'multiple_choice';
    inputs = boxes;
  }

  return {
    number,
    slot,
    page,
    kind,
    moodleType,
    text: normalizeSpace(qtext?.textContent ?? ''),
    instruction,
    state: textOrNull(block.querySelector('.info .state')),
    grade: textOrNull(block.querySelector('.info .grade')),
    outcome: questionOutcome(block),
    rightAnswer: textOrNull(block.querySelector('.outcome .rightanswer')),
    generalFeedback: textOrNull(block.querySelector('.outcome .generalfeedback')),
    choices: inputs.map((input, index) => parseChoice(input, index, pageUrl)),
    images: qtext ? readImages(qtext, pageUrl) : [],
  };
}

function parseChoice(input: HTMLInputElement, index: number, pageUrl: string): Choice {
  const container = input.closest('.r0, .r1') ?? input.parentElement ?? input;
  const letterText = normalizeSpace(container.querySelector('.answernumber')?.textContent ?? '');
  const letterMatch = letterText.match(/^([a-z])/i);
  const letter = letterMatch?.[1]
    ? letterMatch[1].toLowerCase()
    : String.fromCharCode(97 + index);

  const doc = input.ownerDocument;
  const labelledBy = input.getAttribute('aria-labelledby');
  const label =
    (labelledBy ? doc.getElementById(labelledBy) : null) ??
    Array.from(container.querySelectorAll('label')).find((l) => l.htmlFor === input.id) ??
    container;
  const copy = label.cloneNode(true) as Element;
  copy.querySelectorAll('.answernumber, input').forEach((el) => el.remove());

  return {
    letter,
    text: normalizeSpace(copy.textContent ?? ''),
    selected: input.checked,
    outcome: choiceOutcome(container),
    feedback: textOrNull(container.querySelector('.specificfeedback')),
    inputId: input.id,
    images: readImages(label, pageUrl),
  };
}

/** Clase de resultado de `.que` en la revisión; en un intento no aparece. */
function questionOutcome(block: Element): QuestionOutcome | null {
  const c = block.classList;
  if (c.contains('correct')) return 'correct';
  if (c.contains('partiallycorrect')) return 'partial';
  if (c.contains('incorrect')) return 'incorrect';
  if (c.contains('notanswered')) return 'unanswered';
  return null;
}

/** Moodle marca así sólo las opciones elegidas (p. ej. <div class="r0 correct">). */
function choiceOutcome(container: Element): Choice['outcome'] {
  const c = container.classList;
  if (c.contains('correct')) return 'correct';
  if (c.contains('partiallycorrect')) return 'partial';
  if (c.contains('incorrect')) return 'incorrect';
  return null;
}

function readImages(root: Element, pageUrl: string): QuizImage[] {
  const out: QuizImage[] = [];
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const url = cleanUrl(img.getAttribute('src'), pageUrl);
    if (url) out.push({ url, alt: normalizeSpace(img.getAttribute('alt') ?? '') });
  }
  return out;
}

function textOrNull(el: Element | null): string | null {
  return el ? normalizeSpace(el.textContent ?? '') || null : null;
}

function toInt(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value.trim())) return null;
  return Number.parseInt(value.trim(), 10);
}
