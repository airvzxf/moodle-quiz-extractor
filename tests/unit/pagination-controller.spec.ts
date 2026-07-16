// tests/unit/pagination-controller.spec.ts

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { clickNextPage, listPageNav } from '~/moodle/pagination-controller';
import { createDomAdapter } from '~/moodle/dom-adapter';

function makeDoc(html: string): Document {
  const { window } = new JSDOM(html, { url: 'https://m.example.edu/mod/quiz/attempt.php?page=1' });
  return window.document;
}

describe('pagination-controller — clickNextPage', () => {
  it('clicks the next page anchor and reports the destination', () => {
    const doc = makeDoc(`
      <div class="qn_buttons">
        <a class="qnbutton" data-quiz-page="1" href="?page=1">1</a>
        <a class="qnbutton" data-quiz-page="2" href="?page=2">2</a>
        <a class="qnbutton" data-quiz-page="3" href="?page=3">3</a>
      </div>
    `);
    const clicked: string[] = [];
    doc.querySelectorAll('a.qnbutton').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        clicked.push(a.getAttribute('href') ?? '');
      });
    });
    const r = clickNextPage({ document: doc, currentPage: 1 });
    expect(r?.nextPage).toBe(2);
    expect(clicked).toEqual(['?page=2']);
  });

  it('returns null when there is no next page', () => {
    const doc = makeDoc(`
      <div class="qn_buttons">
        <a class="qnbutton" data-quiz-page="1" href="?page=1">1</a>
      </div>
    `);
    const r = clickNextPage({ document: doc, currentPage: 1 });
    expect(r).toBeNull();
  });

  it('returns null when no qnbutton is present', () => {
    const doc = makeDoc('<div>No pagination here</div>');
    const r = clickNextPage({ document: doc, currentPage: 1 });
    expect(r).toBeNull();
  });

  it('skips pages lower than the current one', () => {
    const doc = makeDoc(`
      <div>
        <a class="qnbutton" data-quiz-page="1" href="?page=1">1</a>
        <a class="qnbutton" data-quiz-page="3" href="?page=3">3</a>
      </div>
    `);
    let clicked = '';
    doc.querySelector('a.qnbutton[data-quiz-page="3"]')?.addEventListener('click', (e) => {
      e.preventDefault();
      clicked = '3';
    });
    const r = clickNextPage({ document: doc, currentPage: 1 });
    expect(r?.nextPage).toBe(3);
    expect(clicked).toBe('3');
  });
});

describe('pagination-controller — listPageNav', () => {
  it('returns pages in ascending order', () => {
    const doc = makeDoc(`
      <div>
        <a class="qnbutton" data-quiz-page="3" href="?page=3">3</a>
        <a class="qnbutton" data-quiz-page="1" href="?page=1">1</a>
        <a class="qnbutton" data-quiz-page="2" href="?page=2">2</a>
      </div>
    `);
    const dom = createDomAdapter(doc);
    expect(listPageNav(dom).map((n) => n.page)).toEqual([1, 2, 3]);
  });
});