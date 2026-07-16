// src/moodle/parsers/select.ts
//
// T15 parser for `<select>` dropdown questions. The choice letters come
// from the visible `<option>` text or, when present, from a sibling
// `.answernumber` span. Like radio, a select question accepts exactly
// one letter; multiple-choice is modelled with checkboxes, not with
// `<select multiple>`.

import type { Question } from '~/domain/quiz-schema';
import type { MoodleQuestion } from '../dom-adapter';
import { MQX } from '~/diagnostics/codes';
import type { ParseContext } from './registry';

export async function parseSelect(
  q: MoodleQuestion,
  ctx: ParseContext,
): Promise<Question> {
  const select = findSelect(q);
  if (!select) {
    ctx.warn(MQX.PARSE_NO_VISIBLE_CONTROL, 'select: no visible <select>');
    return unsupported(q, 'select: no <select> in question');
  }

  const options = Array.from(select.querySelectorAll<HTMLOptionElement>('option'))
    .filter((o) => !o.disabled && o.value !== '' && o.value !== '-1');
  if (options.length === 0) {
    return unsupported(q, 'select: no selectable options');
  }

  const choices = options.map((opt, idx) => {
    const text = (opt.textContent ?? '').replace(/\s+/g, ' ').trim();
    // If the option text already starts with "a. " / "a) " use that
    // letter; otherwise assign a synthetic one. We store the synthetic
    // letter in `sourceAnchor` so the applicator (PR #20) can match by
    // index when the option text doesn't expose a Moodle letter.
    const m = text.match(/^([a-zA-Z])[\.\)\]]/);
    const letter = m ? m[1]!.toLowerCase() : String.fromCharCode(97 + idx);
    return {
      letter,
      label: text || letter,
      sourceAnchor: letter,
    };
  });

  const fp = await ctx.fingerprint([
    String(q.visibleNumber),
    'select',
    q.promptMarkdown(),
    ...choices.map((c) => `${c.letter}:${c.label}`),
  ]);

  const warnings: string[] = [];
  if (q.promptImages().length > 0) {
    warnings.push('prompt contains images; will be downloaded in MVP Phase 2');
  }

  const grade = q.grade();

  return {
    number: q.visibleNumber,
    stableFingerprint: fp,
    kind: 'select',
    instruction: q.instruction() ?? undefined,
    promptMarkdown: q.promptMarkdown(),
    choices,
    metadata: {
      gradeRaw: grade.raw ?? undefined,
      gradeValue: grade.value ?? undefined,
      stateRaw: q.state() ?? undefined,
    },
    assets: q.promptImages().map((img) => ({
      localPath: '',
      sourceUrl: img.src,
      status: 'pending' as const,
    })),
    supportedForAutofill: true,
    warnings,
  };
}

function findSelect(q: MoodleQuestion): HTMLSelectElement | null {
  // Avoid `instanceof HTMLSelectElement` because in JSDOM the constructor
  // lives on the window object, not the Node global, and the check would
  // return false. Match by tagName instead, like no-submit-spy.ts does.
  const answer = q.element.querySelector('.answer');
  const root: ParentNode = answer ?? q.element;
  const sel = root.querySelector('select');
  if (!sel || sel.tagName !== 'SELECT') return null;
  if ('disabled' in sel && sel.disabled) return null;
  return sel as HTMLSelectElement;
}

function unsupported(q: MoodleQuestion, message: string): Question {
  return {
    number: q.visibleNumber,
    stableFingerprint: '',
    kind: 'unsupported',
    promptMarkdown: q.promptMarkdown(),
    choices: [],
    metadata: { stateRaw: q.state() ?? undefined },
    assets: [],
    supportedForAutofill: false,
    warnings: [message],
  };
}