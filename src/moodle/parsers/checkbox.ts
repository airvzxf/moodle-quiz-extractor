// src/moodle/parsers/checkbox.ts
//
// T15 parser for "multichoice + multiple answers" questions.
//
// Differences from radio.ts:
// - 1 or more letters can be checked at once
// - name attribute uses _choiceN suffix; we still ignore the raw name and
//   use .answernumber to identify each option
// - hidden companions (one per checkbox) carry the current value; we ignore
//   them at parse time (the dom-adapter already filters .type !== 'hidden')

import type { Question } from '~/domain/quiz-schema';
import type { MoodleQuestion } from '../dom-adapter';
import { MQX } from '~/diagnostics/codes';
import type { ParseContext } from './registry';

export async function parseCheckbox(
  q: MoodleQuestion,
  ctx: ParseContext,
): Promise<Question> {
  const boxes = q.checkboxes();
  if (boxes.length === 0) {
    return {
      number: q.visibleNumber,
      stableFingerprint: '',
      kind: 'unsupported',
      promptMarkdown: q.promptMarkdown(),
      choices: [],
      metadata: { stateRaw: q.state() ?? undefined },
      assets: [],
      supportedForAutofill: false,
      warnings: ['isMultipleChoice()=true but no visible checkbox inputs'],
    };
  }

  const choices = boxes.map((ctrl) => {
    const letter = normalizeLetter(ctrl.sourceAnchor());
    return {
      letter,
      label: extractLabel(ctrl),
      sourceAnchor: letter,
    };
  });

  const fp = await ctx.fingerprint([
    String(q.visibleNumber),
    'checkbox',
    q.promptMarkdown(),
    ...choices.map((c) => `${c.letter}:${c.label}`),
  ]);

  return {
    number: q.visibleNumber,
    stableFingerprint: fp,
    kind: 'multiple_choice',
    instruction: q.instruction() ?? undefined,
    promptMarkdown: q.promptMarkdown(),
    choices,
    metadata: {
      gradeRaw: q.grade().raw ?? undefined,
      gradeValue: q.grade().value ?? undefined,
      stateRaw: q.state() ?? undefined,
    },
    assets: q.promptImages().map((img) => ({
      localPath: '',
      sourceUrl: img.src,
      status: 'pending' as const,
    })),
    supportedForAutofill: true,
    warnings: [],
  };
}

function normalizeLetter(anchor: string): string {
  const trimmed = anchor.replace(/[.)\]]/g, '').trim();
  const m = trimmed.match(/[a-zA-Z]/);
  return m ? m[0].toLowerCase() : '?';
}

function extractLabel(ctrl: { element: HTMLInputElement | HTMLTextAreaElement }): string {
  const container = ctrl.element.closest('.answer, .r0, .r1');
  if (!container) return '';
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.answernumber').forEach((n) => n.remove());
  clone.querySelectorAll('input, textarea').forEach((n) => n.remove());
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}
