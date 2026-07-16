// src/export/source.ts
//
// Helpers to build the QuizDocument's `source` and title/course/unit fields
// from a real MoodleDom. Kept separate from the parser so the renderer can
// be unit-tested against synthetic documents.

import type { QuizDocument, SourceInfo, Question, ExportWarning } from '~/domain/quiz-schema';
import type { MoodleDom } from '~/moodle/dom-adapter';
import { fingerprint } from '~/domain/quiz-schema';

export async function buildSourceInfo(dom: MoodleDom): Promise<SourceInfo> {
  const url = new URL(dom.document.baseURI);
  // originHash: SHA-256 of the canonical origin. Never the full URL.
  const originHash = await fingerprint([url.origin]);
  return {
    originHash,
    path: url.pathname,
    pageCount: dom.listPageNav().length || 1,
    exportedAt: new Date().toISOString(),
  };
}

/** Split a breadcrumb into course/unit. First item is the course, second is
 *  the unit (e.g. "Unidad 1"); the remaining items are not part of the
 *  Markdown H1 (which renders only course + unit, joined by " | "). */
export function splitBreadcrumb(items: ReadonlyArray<string>): {
  course?: string;
  unit?: string;
} {
  if (items.length === 0) return {};
  if (items.length === 1) return { course: items[0] };
  return { course: items[0], unit: items[1] };
}

export async function buildQuizDocument(
  dom: MoodleDom,
  questions: Question[],
  warnings: ExportWarning[] = [],
): Promise<QuizDocument> {
  const source = await buildSourceInfo(dom);
  const { course, unit } = splitBreadcrumb(dom.getBreadcrumbItems());
  return {
    schemaVersion: '1.0',
    title: dom.getQuizTitle() || 'Cuestionario',
    course,
    unit,
    section: dom.getSectionHeading() ?? undefined,
    source,
    questions,
    warnings,
  };
}
