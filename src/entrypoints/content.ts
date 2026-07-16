// src/entrypoints/content.ts
//
// Content script: runs in the page context for `*://*/*mod/quiz/attempt.php*`.
// Detects the quiz, parses it, and answers two runtime messages:
//
//   1. { kind: 'extractQuiz' }            → returns the QuizDocument
//   2. { kind: 'zipQuiz', document }     → forwards to background to build
//                                          the authenticated ZIP and trigger
//                                          the download.

import { createDomAdapter } from '~/moodle/dom-adapter';
import { detectMoodleAttempt } from '~/moodle/detector';
import { parseQuestion } from '~/moodle/parsers/registry';
import { fingerprint } from '~/domain/quiz-schema';
import { buildQuizDocument } from '~/export/source';
import {
  QuizExtractRequestSchema,
  ZipRequestSchema,
  type QuizDocumentMessage,
  type ZipResult,
} from '~/messaging/runtime-messages';
import { QuizDocumentSchema } from '~/domain/quiz-schema';

export default defineContentScript({
  matches: ['*://*/*mod/quiz/attempt.php*'],
  runAt: 'document_idle',
  main() {
    // eslint-disable-next-line no-console
    console.log('[moodle-quiz-extractor] content script loaded');

    browser.runtime.onMessage.addListener(
      (raw: unknown, _sender, sendResponse: (response: unknown) => void) => {
        const req = QuizExtractRequestSchema.safeParse(raw);
        if (req.success) {
          void handleExtract()
            .then((doc) => sendResponse({ kind: 'quizDocument', document: doc }))
            .catch((err: Error) =>
              sendResponse({
                kind: 'quizDocument',
                document: null,
                error: err.message,
              }),
            );
          return true;
        }
        const zipReq = ZipRequestSchema.safeParse(raw);
        if (zipReq.success) {
          const parsedDoc = QuizDocumentSchema.safeParse(zipReq.data.document);
          if (!parsedDoc.success) {
            const result: ZipResult = {
              kind: 'zipResult',
              ok: false,
              error: 'invalid QuizDocument payload',
            };
            sendResponse(result);
            return false;
          }
          browser.runtime
            .sendMessage({
              kind: 'zipQuiz',
              document: parsedDoc.data,
              tabUrl: window.location.href,
            })
            .then((res) => sendResponse(res))
            .catch((err: Error) => {
              const result: ZipResult = {
                kind: 'zipResult',
                ok: false,
                error: err.message,
              };
              sendResponse(result);
            });
          return true;
        }
        return false;
      },
    );
  },
});

async function handleExtract() {
  const dom = createDomAdapter(document);
  const result = detectMoodleAttempt(dom);
  if (result.kind !== 'supported') {
    throw new Error(`cannot extract: ${result.kind}/${'reason' in result ? result.reason : ''}`);
  }
  const warns: Array<{ code: string; stage: 'parse'; message: string }> = [];
  const questions = await Promise.all(
    dom.listQuestions().map((q) =>
      parseQuestion(q, {
        fingerprint,
        warn: (code, message) => warns.push({ code, stage: 'parse', message }),
      }),
    ),
  );
  return buildQuizDocument(dom, questions, warns);
}

// Reference unused helper to satisfy the type-checker when consumers strip
// the message types (they're documented in `runtime-messages.ts`).
void ({} as QuizDocumentMessage);