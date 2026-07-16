// src/autofill/redact-answers.ts
//
// Wrapper around `redactString` for every line of an answer list before
// it leaves the browser. The user-typed text is treated as untrusted
// because the popup preview will paint it into the DOM.
//
// Fail-closed: throws `MqxPrivLeakError` if any canary pattern matches.
// This catches a class of bugs where a future contributor adds a new
// log/clipboard/export path that includes user-typed answers.

import { redactString } from '~/diagnostics/redactor';
import type { ParsedAnswer } from './answer-list-parser';

export function redactParsedAnswers(
  answers: ReadonlyArray<ParsedAnswer>,
): ReadonlyArray<ParsedAnswer> {
  return answers.map((a) => redactAnswer(a));
}

export function redactAnswer(a: ParsedAnswer): ParsedAnswer {
  if (typeof a.value === 'string') {
    return { ...a, value: redactString(a.value) };
  }
  return {
    ...a,
    value: a.value.map((v) => redactString(v)),
  };
}