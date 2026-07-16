// src/moodle/detector.ts
//
// T15 RF-1: detection. Returns a discriminated union so callers must handle
// every case. No throws for the common "not a quiz" path.

import type { MoodleDom } from './dom-adapter';

export type MoodleDetectionResult =
  | { kind: 'supported'; reason: 'attempt-page' }
  | { kind: 'notQuiz'; reason: 'path-mismatch' | 'no-form' | 'no-questions' }
  | { kind: 'expiredSession'; reason: 'login-form-detected' }
  | { kind: 'finishedAttempt'; reason: 'summary-page' }
  | { kind: 'unsupportedLayout'; reason: string };

const LOGIN_INDICATORS = [
  'input[name=username]',
  'input[name=password]',
  'form#login',
  '.login-form',
];

const SUMMARY_INDICATORS = [
  '.quiz-summary',
  '.attempt-summary',
  '.generaltable.attemptsummary',
  'input[name=finishattempt]',
];

export function detectMoodleAttempt(dom: MoodleDom): MoodleDetectionResult {
  if (!dom.isAttemptPage()) {
    return { kind: 'notQuiz', reason: 'path-mismatch' };
  }
  if (hasAny(dom.document, SUMMARY_INDICATORS)) {
    return { kind: 'finishedAttempt', reason: 'summary-page' };
  }
  if (hasAny(dom.document, LOGIN_INDICATORS)) {
    return { kind: 'expiredSession', reason: 'login-form-detected' };
  }
  if (!dom.hasResponseForm()) {
    return { kind: 'notQuiz', reason: 'no-form' };
  }
  if (!dom.hasQuestions()) {
    return { kind: 'notQuiz', reason: 'no-questions' };
  }
  return { kind: 'supported', reason: 'attempt-page' };
}

function hasAny(document: Document, selectors: ReadonlyArray<string>): boolean {
  for (const s of selectors) {
    if (document.querySelector(s)) return true;
  }
  return false;
}
