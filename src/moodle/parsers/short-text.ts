// src/moodle/parsers/short-text.ts
//
// T15 parser for "short answer" questions: a single `<input type=text>`
// inside the .answer block. The user's text is captured verbatim from
// the rendered HTML; no choice letters are produced (the kind's `choices`
// array stays empty).
//
// Fingerprint inputs are the visible number + the literal kind tag
// ('short_text') + the prompt text. No choice letters are mixed in.

import type { Question } from '~/domain/quiz-schema';
import type { MoodleQuestion } from '../dom-adapter';
import { MQX } from '~/diagnostics/codes';
import type { ParseContext } from './registry';

export async function parseShortText(
  q: MoodleQuestion,
  ctx: ParseContext,
): Promise<Question> {
  const inputs = q.textInputs();
  if (inputs.length === 0) {
    ctx.warn(MQX.PARSE_NO_VISIBLE_CONTROL, 'short_text: no visible <input type=text>');
    return unsupported(q, 'short_text: no visible input');
  }

  const fp = await ctx.fingerprint([
    String(q.visibleNumber),
    'short_text',
    q.promptMarkdown(),
  ]);

  const warnings: string[] = [];
  if (q.promptImages().length > 0) {
    warnings.push('prompt contains images; will be downloaded in MVP Phase 2');
  }

  const grade = q.grade();

  return {
    number: q.visibleNumber,
    stableFingerprint: fp,
    kind: 'short_text',
    instruction: q.instruction() ?? undefined,
    promptMarkdown: q.promptMarkdown(),
    choices: [],
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