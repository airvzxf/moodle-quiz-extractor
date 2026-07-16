// src/moodle/parsers/registry.ts
//
// T15's parser registry. Each parser owns ONE question kind and returns a
// normalized Question (or an "unsupported" one with a warning). The
// registry runs the right parser based on the control shape detected by
// the DOM adapter.

import type { Question } from '~/domain/quiz-schema';
import type { MoodleQuestion } from '../dom-adapter';
import { parseRadio } from './radio';
import { parseCheckbox } from './checkbox';
import { parseShortText } from './short-text';
import { parseLongText } from './long-text';
import { parseSelect } from './select';
import { parseUnsupported } from './unsupported';
import { MQX } from '~/diagnostics/codes';

export interface ParseContext {
  fingerprint: (parts: ReadonlyArray<string>) => Promise<string>;
  /** Warn collector; never receives raw input names or session values. */
  warn: (code: string, message: string) => void;
}

export async function parseQuestion(
  q: MoodleQuestion,
  ctx: ParseContext,
): Promise<Question> {
  // Decision order (T15 detector): checkbox wins over radio wins over
  // textarea/text wins over select wins over unsupported.
  if (q.isMultipleChoice()) {
    return parseCheckbox(q, ctx);
  }
  if (q.radios().length > 0) {
    return parseRadio(q, ctx);
  }
  if (q.textareas().length > 0) {
    return parseLongText(q, ctx);
  }
  if (q.textInputs().length > 0) {
    return parseShortText(q, ctx);
  }
  if (hasSelect(q)) {
    return parseSelect(q, ctx);
  }
  return parseUnsupported(q, {
    reason: 'no recognized control in question',
    code: MQX.PARSE_UNKNOWN,
  });
}

function hasSelect(q: MoodleQuestion): boolean {
  const answer = q.element.querySelector('.answer');
  const root: ParentNode = answer ?? q.element;
  const sel = root.querySelector('select');
  return sel instanceof HTMLSelectElement && !sel.disabled;
}
