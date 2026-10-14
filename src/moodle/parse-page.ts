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
  try {
    return /\/mod\/quiz\/attempt\.php$/.test(new URL(url).pathname);
  } catch {
    return false;
  }
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
  for (const a of Array.from(doc.querySelectorAll('a.qnbutton[data-quiz-page]'))) {
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
 * `attempt` y `cmid`. Sólo se leen las preguntas dentro de #responseform.
 */
export function parseAttemptPage(doc: Document, pageUrl: string): ParsedPage {
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
  for (const block of Array.from(doc.querySelectorAll('form#responseform div.que'))) {
    const q = parseQuestion(block, navigation.currentPage, pageUrl);
    if (q) questions.push(q);
  }

  return {
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
    copy.querySelectorAll('.sr-only').forEach((el) => el.remove());
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
    inputId: input.id,
    images: readImages(label, pageUrl),
  };
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
