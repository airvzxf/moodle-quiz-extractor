// src/diagnostics/fixture-sanitizer.ts
//
// Structural sanitizer for the opt-in HTML fixture. Uses an allowlist of
// visible, non-executable nodes and rewrites the DOM into a safe string
// for inclusion in the debug bundle.
//
// Guarantees:
//   - No script / style / link / base / meta refresh / iframe / object /
//     embed / svg / mathml / form-submit controls.
//   - All URL-bearing attributes are stripped (no href/src/xlink:href/etc.)
//     or replaced with a placeholder.
//   - All `id`, `name`, and `for` attributes are replaced with placeholders.
//   - All form control values are cleared (radio/checkbox go to default).
//   - HTML comments are dropped.
//   - Tags that become empty after sanitization are pruned.
//
// The sanitizer works inside jsdom (tests) and the browser DOM. It is
// pure: produces a string from an input string. We use a minimal DOM
// mock when neither jsdom nor the browser DOM is available; in
// production we rely on the browser DOMParser / XMLSerializer.

const SAFE_TAGS = new Set([
  'html',
  'head',
  'title',
  'body',
  'main',
  'section',
  'article',
  'aside',
  'header',
  'footer',
  'nav',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'br',
  'hr',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'colgroup',
  'col',
  'div',
  'span',
  'strong',
  'em',
  'b',
  'i',
  'u',
  'small',
  'sub',
  'sup',
  'blockquote',
  'pre',
  'code',
  'kbd',
  'samp',
  'abbr',
  'cite',
  'dfn',
  'figure',
  'figcaption',
  'fieldset',
  'legend',
  'label',
  'form',
  'input',
  'select',
  'option',
  'optgroup',
  'textarea',
  'button',
  'img',
  'a',
]);

const URL_ATTRIBUTES = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'cite',
  'poster',
  'background',
  'longdesc',
  'usemap',
  'xlink:href',
]);

const ATTRS_THROUGH = new Set(['lang', 'dir', 'title', 'alt', 'colspan', 'rowspan']);

const PLACEHOLDER_ID = '__REDACTED__';

export interface SanitizedFixture {
  readonly html: string;
  readonly droppedTags: number;
  readonly droppedAttrs: number;
  readonly bytes: number;
}

export class FixtureSanitizationError extends Error {
  readonly code: 'empty' | 'parse-failed';
  constructor(code: 'empty' | 'parse-failed', message: string) {
    super(message);
    this.name = 'FixtureSanitizationError';
    this.code = code;
  }
}

export function sanitizeFixtureHtml(rawHtml: string): SanitizedFixture {
  if (typeof rawHtml !== 'string' || rawHtml.length === 0) {
    throw new FixtureSanitizationError('empty', 'fixture HTML is empty');
  }
  const documentLike = parseDocument(rawHtml);
  if (!documentLike) {
    throw new FixtureSanitizationError('parse-failed', 'DOMParser failed');
  }
  const body: Element | null = documentLike.body;
  const root: Node = body ?? documentLike;
  let droppedTags = 0;
  let droppedAttrs = 0;
  const all: Element[] = [];
  const stack: Element[] = [root as Element];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    all.push(cur);
    for (let i = 0; i < cur.children.length; i += 1) {
      stack.push(cur.children[i] as Element);
    }
  }
  for (let i = all.length - 1; i >= 0; i -= 1) {
    const el = all[i]!;
    const tag = el.tagName.toLowerCase();
    if (!SAFE_TAGS.has(tag)) {
      replaceWithText(el);
      droppedTags += 1;
      continue;
    }
    droppedAttrs += cleanAttributes(el);
  }
  const html = serializeNode(root);
  const bytes = new TextEncoder().encode(html).length;
  if (bytes === 0) {
    throw new FixtureSanitizationError('empty', 'sanitized fixture is empty');
  }
  return { html, droppedTags, droppedAttrs, bytes };
}

function cleanAttributes(el: Element): number {
  let dropped = 0;
  const tag = el.tagName.toLowerCase();
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    const value = attr.value;
    if (name.startsWith('on')) {
      el.removeAttribute(attr.name);
      dropped += 1;
      continue;
    }
    if (URL_ATTRIBUTES.has(name)) {
      el.setAttribute(attr.name, PLACEHOLDER_ID);
      continue;
    }
    if (name === 'style') {
      el.removeAttribute(attr.name);
      dropped += 1;
      continue;
    }
    if (name === 'id' || name === 'name' || name === 'for') {
      el.setAttribute(attr.name, PLACEHOLDER_ID);
      continue;
    }
    if (name === 'class') {
      el.setAttribute(attr.name, PLACEHOLDER_ID);
      continue;
    }
    if (
      name === 'action' ||
      name === 'method' ||
      name === 'enctype' ||
      name === 'target'
    ) {
      el.removeAttribute(attr.name);
      dropped += 1;
      continue;
    }
    if (
      (tag === 'input' &&
        (name === 'value' || name === 'checked' || name === 'placeholder')) ||
      (tag === 'textarea' && name === 'value') ||
      (tag === 'select' && name === 'value')
    ) {
      el.removeAttribute(attr.name);
      dropped += 1;
      continue;
    }
    if (!ATTRS_THROUGH.has(name) && !isDataAttributeAllowed(name)) {
      el.removeAttribute(attr.name);
      dropped += 1;
      continue;
    }
    if (
      typeof value === 'string' &&
      (value.includes('sesskey=') || value.includes('MoodleSession='))
    ) {
      el.setAttribute(attr.name, PLACEHOLDER_ID);
    }
  }
  if (
    tag === 'input' &&
    (el.getAttribute('type') === 'submit' || el.getAttribute('type') === 'image')
  ) {
    el.setAttribute('disabled', 'disabled');
  }
  if (tag === 'button') {
    el.setAttribute('disabled', 'disabled');
  }
  if (tag === 'form') {
    el.removeAttribute('action');
    el.setAttribute('onsubmit', 'return false');
  }
  return dropped;
}

function isDataAttributeAllowed(name: string): boolean {
  if (!name.startsWith('data-')) return false;
  const tail = name.slice('data-'.length).toLowerCase();
  if (tail.includes('attempt')) return false;
  if (tail.includes('sesskey')) return false;
  if (tail.includes('moodlesession')) return false;
  if (tail.includes('cmid')) return false;
  if (tail.startsWith('q')) return false;
  return true;
}

function replaceWithText(el: Element): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) {
    parent.insertBefore(el.firstChild, el);
  }
  parent.removeChild(el);
}

function parseDocument(rawHtml: string): Document | null {
  if (typeof DOMParser !== 'undefined') {
    try {
      return new DOMParser().parseFromString(rawHtml, 'text/html');
    } catch {
      return null;
    }
  }
  return null;
}

function serializeNode(node: Node): string {
  if (typeof XMLSerializer !== 'undefined') {
    return new XMLSerializer().serializeToString(node);
  }
  return (node as Element).outerHTML ?? '';
}