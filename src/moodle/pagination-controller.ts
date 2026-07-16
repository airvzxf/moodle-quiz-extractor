// src/moodle/pagination-controller.ts
//
// Pagination of a Moodle quiz attempt. The chosen strategy per the Fase 3
// plan is **synthetic click**: the user-visible
// `<a class="qnbutton" data-quiz-page="N">` buttons are clicked via the
// DOM, which preserves Moodle's CSRF/referer/event plumbing. The browser
// navigates as if the user had clicked, the content script's
// MutationObserver settles, and the new page re-extracts.
//
// This module exposes a single helper that finds and clicks the next
// page button. The caller (content script) is responsible for waiting
// for the resulting `pageshow` / `popstate` and re-extracting the
// QuizDocument.

import type { MoodleDom } from '~/moodle/dom-adapter';
import { createDomAdapter } from '~/moodle/dom-adapter';

export interface ClickNextPageInput {
  readonly document: Document;
  /** Current page number (1-based). */
  readonly currentPage: number;
}

export interface ClickNextPageOutcome {
  /** The page that would be navigated to. */
  readonly nextPage: number;
}

/**
 * Clicks the `<a class="qnbutton" data-quiz-page="N">` for the next
 * page after `currentPage`. Returns the page number that would be
 * navigated to, or `null` if there is no further page.
 *
 * The caller must listen for the resulting DOM mutation and re-extract
 * the QuizDocument — this function does NOT wait for navigation.
 */
export function clickNextPage(input: ClickNextPageInput): ClickNextPageOutcome | null {
  const dom = createDomAdapter(input.document);
  const nav = dom.listPageNav();
  const next = nav.find((n) => n.page > input.currentPage);
  if (!next) return null;
  const anchor = input.document.querySelector<HTMLAnchorElement>(
    `a.qnbutton[data-quiz-page="${next.page}"]`,
  );
  if (!anchor) return null;
  anchor.click();
  return { nextPage: next.page };
}

/** Helper exposed for tests: list all visible page buttons in order. */
export function listPageNav(dom: MoodleDom): ReadonlyArray<{ page: number; label: string }> {
  return dom.listPageNav();
}