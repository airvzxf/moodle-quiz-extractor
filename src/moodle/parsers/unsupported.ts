// src/moodle/parsers/unsupported.ts
//
// Fallback parser: emit a Question with kind='unsupported' so the Markdown
// renderer still produces output (with a clear "Tipo: No soportado"
// metadata line) and the user can decide what to do. The autofill engine
// is blocked on this question specifically, not on the whole quiz.

import type { Question } from '~/domain/quiz-schema';
import type { MoodleQuestion } from '../dom-adapter';

export interface UnsupportedReason {
  code: string;
  reason: string;
}

export function parseUnsupported(
  q: MoodleQuestion,
  reason: UnsupportedReason,
): Question {
  return {
    number: q.visibleNumber,
    stableFingerprint: '',
    kind: 'unsupported',
    promptMarkdown: q.promptMarkdown(),
    choices: [],
    metadata: { stateRaw: q.state() ?? undefined },
    assets: [],
    supportedForAutofill: false,
    warnings: [`${reason.code}: ${reason.reason}`],
  };
}
