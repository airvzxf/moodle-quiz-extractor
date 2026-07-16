// src/moodle/parsers/radio.ts
//
// T15 parser for "multichoice + single answer" questions.
//
// Rules (verified against dsop-01, dsop-02, ddoo-01, ddoo-02):
// - one or more `input[type=radio]` (NOT hidden, NOT disabled, NOT value="-1"
//   which is Moodlish "clear my choice")
// - each option has a sibling `.answernumber` (letter) and a label
// - `qtext` is the prompt; `prompt` is the instruction
// - `info .state` and `info .grade` provide metadata

import type { Question } from '~/domain/quiz-schema';
import type { MoodleQuestion } from '../dom-adapter';
import { fingerprint } from '~/domain/quiz-schema';
import { MQX } from '~/diagnostics/codes';
import type { ParseContext } from './registry';

export async function parseRadio(
  q: MoodleQuestion,
  ctx: ParseContext,
): Promise<Question> {
  const radios = q.radios();
  if (radios.length === 0) {
    return unsupported(q, 'no visible radio inputs in question');
  }

  const choices = radios
    .map((ctrl) => {
      const letter = normalizeLetter(ctrl.sourceAnchor());
      const label = extractLabel(ctrl);
      return { letter, label, sourceAnchor: letter };
    })
    .filter((c) => c.letter !== '-1'); // defensive: skip clear-choice

  if (choices.length === 0) {
    ctx.warn(MQX.PARSE_UNKNOWN, 'all radios had invalid letter; treating as unsupported');
  }

  const fp = await ctx.fingerprint([
    String(q.visibleNumber),
    'radio',
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
    kind: 'single_choice',
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
    supportedForAutofill: choices.length > 0,
    warnings,
  };
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

function normalizeLetter(anchor: string): string {
  const trimmed = anchor.replace(/[.)\]]/g, '').trim();
  // First letter; or the literal value if anchor is "-1" (clear choice).
  const m = trimmed.match(/[a-zA-Z]/);
  return m ? m[0].toLowerCase() : '-1';
}

function extractLabel(ctrl: { element: HTMLInputElement | HTMLTextAreaElement }): string {
  // Walk up to the .r0/.r1/.answer container, then collect its label text
  // EXCLUDING the .answernumber span and the actual <input>/<textarea>
  // controls (so the letter is not duplicated and the control itself is
  // not echoed).
  const container = ctrl.element.closest('.answer, .r0, .r1');
  if (!container) return '';
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.answernumber').forEach((n) => n.remove());
  // Remove the <input> and <textarea> nodes (NOT their parents, which are
  // the .r0/.r1 containers we are trying to read).
  clone.querySelectorAll('input, textarea').forEach((n) => n.remove());
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}
