// src/moodle/parsers/long-text.ts
//
// T15 parser for "essay / long answer" questions: one or more
// `<textarea>` elements inside the .answer block. The actual content is
// not extracted (textareas are empty when first rendered); the parser
// only needs to identify the question kind so the autofill engine can
// target it.
//
// Choices stay empty; the applicator (PR #20) will populate the textarea
// with the user's free-text answer.

import type { Question } from '~/domain/quiz-schema';
import type { MoodleQuestion } from '../dom-adapter';
import { MQX } from '~/diagnostics/codes';
import type { ParseContext } from './registry';

export async function parseLongText(
  q: MoodleQuestion,
  ctx: ParseContext,
): Promise<Question> {
  const areas = q.textareas();
  if (areas.length === 0) {
    ctx.warn(MQX.PARSE_NO_VISIBLE_CONTROL, 'long_text: no visible <textarea>');
    return unsupported(q, 'long_text: no visible textarea');
  }

  const fp = await ctx.fingerprint([
    String(q.visibleNumber),
    'long_text',
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
    kind: 'long_text',
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