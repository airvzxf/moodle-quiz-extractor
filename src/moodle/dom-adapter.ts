// src/moodle/dom-adapter.ts
//
// Adapter over the DOM. The content script hands us a real Document; tests
// hand us a JSDOM Document. The adapter is the only place that knows about
// Moodle CSS classes; parsers consume only the adapter's narrow interface.

export interface MoodleDom {
  readonly document: Document;
  /** true if the page is a quiz attempt page. */
  isAttemptPage(): boolean;
  /** true if the form expected by Moodle is present and the page is not the summary. */
  hasResponseForm(): boolean;
  /** true if any .que block is present. */
  hasQuestions(): boolean;
  /** Questions, in document order. Visible number is `qno`, not the slot. */
  listQuestions(): MoodleQuestion[];
  /** Quiz title from .page-header-headings h1 (null if missing). */
  getQuizTitle(): string | null;
  /** Course / unit / section, when discoverable. */
  getCourseBreadcrumb(): string | null;
  /** Structured breadcrumb: each .breadcrumb-item as a separate entry. */
  getBreadcrumbItems(): string[];
  /** mod_quiz-section-heading h3 — ABSENT in ddoo-02, so this may return null. */
  getSectionHeading(): string | null;
  /** `<a class="qnbutton" data-quiz-page="N">` — pages observed via nav. */
  listPageNav(): MoodlePageNav[];
  /** The form that contains the radio/checkbox controls. */
  getResponseForm(): HTMLFormElement | null;
}

export interface MoodleQuestion {
  /** Visible number from `.qno` (1..N). NEVER the slot. */
  visibleNumber: number;
  /** Container element, for parsers that need sub-selectors. */
  element: HTMLElement;
  /** The "Que es el cielo?" text node, sanitized. */
  promptMarkdown(): string;
  /** The "Selecciona una opción" text node, sanitized. Optional. */
  instruction(): string | null;
  /** State ("Sin responder aún", "Respondida", etc.). */
  state(): string | null;
  /** Grade as raw text and parsed number. */
  grade(): { raw: string | null; value: number | null };
  /** All visible (non-hidden) radio inputs INSIDE the .answer block. */
  radios(): MoodleControl[];
  /** All visible (non-hidden) checkbox inputs INSIDE the .answer block. */
  checkboxes(): MoodleControl[];
  /** All text inputs (input[type=text]) INSIDE this question. */
  textInputs(): MoodleControl[];
  /** All textareas INSIDE this question. */
  textareas(): MoodleControl[];
  /** All `<img>` inside .qtext. */
  promptImages(): MoodleImage[];
  /** True iff the question contains at least one visible checkbox. */
  isMultipleChoice(): boolean;
}

export interface MoodleControl {
  element: HTMLInputElement | HTMLTextAreaElement;
  /** Source anchor — sibling label or the .answernumber letter, NEVER the raw name. */
  sourceAnchor(): string;
  /** True iff the underlying input has type="hidden". */
  isHidden(): boolean;
}

export interface MoodleImage {
  element: HTMLImageElement;
  /** Original src as observed (URL on the Moodle origin). */
  src: string;
  /** Original alt text, when present. */
  alt: string;
}

export interface MoodlePageNav {
  page: number;
  label: string;
}

// WXT/Vite pulls in `chrome`/`browser` shims only inside entrypoints. The
// adapter works with any global `Document`; tests use jsdom, the content
// script uses the real one.
export function createDomAdapter(document: Document): MoodleDom {
  return new DefaultMoodleDom(document);
}

class DefaultMoodleDom implements MoodleDom {
  constructor(public readonly document: Document) {}

  isAttemptPage(): boolean {
    const p = new URL(this.document.baseURI).pathname;
    return /\/mod\/quiz\/attempt\.php$/.test(p);
  }

  hasResponseForm(): boolean {
    return this.document.getElementById('responseform') !== null;
  }

  hasQuestions(): boolean {
    return this.document.querySelectorAll('div.que').length > 0;
  }

  listQuestions(): MoodleQuestion[] {
    const blocks = Array.from(
      this.document.querySelectorAll<HTMLElement>('div.que'),
    );
    return blocks.map((el) => new DefaultMoodleQuestion(el));
  }

  getQuizTitle(): string | null {
    const h1 = this.document.querySelector(
      '.page-header-headings h1, h1#page-title',
    );
    return h1?.textContent?.trim() || null;
  }

  getCourseBreadcrumb(): string | null {
    const crumb = this.document.querySelector(
      '.breadcrumb, [aria-label*="rumb"] nav',
    );
    return crumb?.textContent?.replace(/\s+/g, ' ').trim() || null;
  }

  getBreadcrumbItems(): string[] {
    const items = Array.from(
      this.document.querySelectorAll<HTMLElement>('.breadcrumb-item'),
    );
    return items
      .map((it) => it.textContent?.replace(/\s+/g, ' ').trim() || '')
      .filter(Boolean);
  }

  getSectionHeading(): string | null {
    const h = this.document.querySelector('h3.mod_quiz-section-heading');
    return h?.textContent?.trim() || null;
  }

  listPageNav(): MoodlePageNav[] {
    const anchors = Array.from(
      this.document.querySelectorAll<HTMLAnchorElement>('a.qnbutton'),
    );
    const seen = new Set<number>();
    const out: MoodlePageNav[] = [];
    for (const a of anchors) {
      const raw = a.getAttribute('data-quiz-page');
      if (raw === null) continue;
      const page = Number.parseInt(raw, 10);
      if (Number.isNaN(page) || seen.has(page)) continue;
      seen.add(page);
      out.push({ page, label: a.textContent?.trim() || String(page) });
    }
    out.sort((a, b) => a.page - b.page);
    return out;
  }

  getResponseForm(): HTMLFormElement | null {
    const f = this.document.getElementById('responseform');
    return f instanceof HTMLFormElement ? f : null;
  }
}

class DefaultMoodleQuestion implements MoodleQuestion {
  constructor(public readonly element: HTMLElement) {}

  get visibleNumber(): number {
    const qno = this.element.querySelector('.qno');
    const raw = qno?.textContent?.trim() ?? '';
    const m = raw.match(/\d+/);
    return m ? Number.parseInt(m[0], 10) : 0;
  }

  promptMarkdown(): string {
    const qtext = this.element.querySelector('.qtext');
    if (!qtext) return '';
    // The renderer will apply Turndown. Here we just return textContent so
    // parsers don't depend on Turndown for fingerprints.
    return (qtext.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  instruction(): string | null {
    const prompt = this.element.querySelector('.prompt');
    return prompt?.textContent?.replace(/\s+/g, ' ').trim() || null;
  }

  state(): string | null {
    const s = this.element.querySelector('.info .state');
    return s?.textContent?.trim() || null;
  }

  grade(): { raw: string | null; value: number | null } {
    const g = this.element.querySelector('.info .grade');
    const raw = g?.textContent?.trim() || null;
    if (!raw) return { raw: null, value: null };
    const m = raw.replace(',', '.').match(/-?\d+(?:\.\d+)?/);
    return { raw, value: m ? Number.parseFloat(m[0]) : null };
  }

  private visibleInputs<T extends HTMLInputElement>(selector: string): T[] {
    return Array.from(this.element.querySelectorAll<T>(selector)).filter(
      (i) => i.type !== 'hidden' && !i.disabled,
    );
  }

  /** Scope to the .answer block so the question-flag checkbox and the
   * clear-choice radio (`value="-1"`, outside .answer) are NOT counted. */
  private inAnswer<T extends HTMLElement>(selector: string): T[] {
    const answer = this.element.querySelector('.answer');
    const root: ParentNode = answer ?? this.element;
    return Array.from(root.querySelectorAll<T>(selector));
  }

  radios(): MoodleControl[] {
    return this.inAnswer<HTMLInputElement>('input[type=radio]').map(
      (el) => new DefaultMoodleControl(el),
    );
  }

  checkboxes(): MoodleControl[] {
    return this.inAnswer<HTMLInputElement>('input[type=checkbox]').map(
      (el) => new DefaultMoodleControl(el),
    );
  }

  textInputs(): MoodleControl[] {
    return this.visibleInputs<HTMLInputElement>('input[type=text]').map(
      (el) => new DefaultMoodleControl(el),
    );
  }

  textareas(): MoodleControl[] {
    return Array.from(
      this.element.querySelectorAll<HTMLTextAreaElement>('textarea'),
    )
      .filter((t) => !t.disabled)
      .map((t) => new DefaultMoodleControl(t));
  }

  promptImages(): MoodleImage[] {
    const imgs = Array.from(this.element.querySelectorAll<HTMLImageElement>('.qtext img'));
    return imgs.map((el) => ({
      element: el,
      src: el.getAttribute('src') || el.src || '',
      alt: el.getAttribute('alt') || '',
    }));
  }

  isMultipleChoice(): boolean {
    return this.checkboxes().length > 0;
  }
}

class DefaultMoodleControl implements MoodleControl {
  constructor(public readonly element: HTMLInputElement | HTMLTextAreaElement) {}

  sourceAnchor(): string {
    // Prefer .answernumber letter when present (radio/checkbox case).
    const answernumber = this.element
      .closest('.answer, .r0, .r1')
      ?.querySelector('.answernumber');
    if (answernumber) {
      return answernumber.textContent?.trim() || '?';
    }
    // Fallback: sibling label text.
    const id = this.element.getAttribute('id');
    if (id) {
      const label = this.element.ownerDocument.querySelector(`label[for="${id}"]`);
      if (label) return label.textContent?.replace(/\s+/g, ' ').trim() || '?';
    }
    return '?';
  }

  isHidden(): boolean {
    if (this.element instanceof HTMLInputElement) {
      return this.element.type === 'hidden';
    }
    return false;
  }
}
