// src/entrypoints/content.ts
//
// Content script: runs in the page context for `*://*/*mod/quiz/attempt.php*`.
// Detects the quiz, parses it, and answers runtime messages:
//
//   1. { kind: 'extractQuiz' }            → returns the QuizDocument
//   2. { kind: 'zipQuiz', document }     → forwards to background to build
//                                          the authenticated ZIP and trigger
//                                          the download.
//   3. { kind: 'prepareAutofill', ... }  → parses the user's answer list and
//                                          validates it against the live
//                                          QuizDocument; persists a job in
//                                          storage.session.
//   4. { kind: 'applyAutofill', jobId }  → runs the ApplyPlan with the form
//                                          + fetch spies engaged.
//   5. { kind: 'abortAutofill', jobId }  → cancels the job.
//   6. { kind: 'getAutofillJob', jobId } → reports the job state (resume
//                                          after crash).

import { createDomAdapter } from '~/moodle/dom-adapter';
import { detectMoodleAttempt } from '~/moodle/detector';
import { parseQuestion } from '~/moodle/parsers/registry';
import { fingerprint } from '~/domain/quiz-schema';
import { buildQuizDocument } from '~/export/source';
import { parseAnswerList } from '~/autofill/answer-list-parser';
import { buildApplyPlan } from '~/autofill/apply-plan';
import { installNoSubmitSpy } from '~/moodle/applicators/no-submit-spy';
import { installFetchSpy } from '~/moodle/applicators/fetch-spy';
import { applyStep } from '~/moodle/applicators/control-applicator';
import { QuizDocumentSchema } from '~/domain/quiz-schema';
import {
  ApplyAutofillRequestSchema,
  type ApplyAutofillResult,
  AbortAutofillRequestSchema,
  GetAutofillJobRequestSchema,
  type GetAutofillJobResult,
  PrepareAutofillRequestSchema,
  type PrepareAutofillRequest,
  type PrepareAutofillResult,
  QuizExtractRequestSchema,
  ZipRequestSchema,
  type QuizDocumentMessage,
  type ZipResult,
} from '~/messaging/runtime-messages';
import { redactString } from '~/diagnostics/redactor';

interface AutofillJobState {
  plan: import('~/autofill/apply-plan').ApplyPlan;
  applied: number;
  total: number;
  formSpy: ReturnType<typeof installNoSubmitSpy> | null;
  fetchSpy: ReturnType<typeof installFetchSpy> | null;
}

const activeJobs = new Map<string, AutofillJobState>();

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
        const prep = PrepareAutofillRequestSchema.safeParse(raw);
        if (prep.success) {
          void handlePrepare(prep.data)
            .then(sendResponse)
            .catch((err: Error) => {
              const result: PrepareAutofillResult = {
                kind: 'prepareAutofillResult',
                jobId: prep.data.jobId,
                ok: false,
                errors: [err.message],
              };
              sendResponse(result);
            });
          return true;
        }
        const apply = ApplyAutofillRequestSchema.safeParse(raw);
        if (apply.success) {
          void handleApply(apply.data.jobId)
            .then(sendResponse)
            .catch((err: Error) => {
              const result: ApplyAutofillResult = {
                kind: 'applyAutofillResult',
                jobId: apply.data.jobId,
                ok: false,
                applied: 0,
                total: 0,
                errors: [err.message],
              };
              sendResponse(result);
            });
          return true;
        }
        const abort = AbortAutofillRequestSchema.safeParse(raw);
        if (abort.success) {
          handleAbort(abort.data.jobId);
          sendResponse({ kind: 'abortAutofillResult', jobId: abort.data.jobId, ok: true });
          return false;
        }
        const get = GetAutofillJobRequestSchema.safeParse(raw);
        if (get.success) {
          const state = activeJobs.get(get.data.jobId);
          const result: GetAutofillJobResult = {
            kind: 'getAutofillJobResult',
            jobId: get.data.jobId,
            found: state !== undefined,
            state: state ? `applying (${state.applied}/${state.total})` : undefined,
          };
          sendResponse(result);
          return false;
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

async function handlePrepare(req: PrepareAutofillRequest): Promise<PrepareAutofillResult> {
  const dom = createDomAdapter(document);
  const detected = detectMoodleAttempt(dom);
  if (detected.kind !== 'supported') {
    return {
      kind: 'prepareAutofillResult',
      jobId: req.jobId,
      ok: false,
      errors: [`cannot prepare: ${detected.kind}`],
    };
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
  const doc = await buildQuizDocument(dom, questions, warns);

  const answersParse = parseAnswerList(redactString(req.answersText));
  if (!answersParse.ok) {
    return {
      kind: 'prepareAutofillResult',
      jobId: req.jobId,
      ok: false,
      errors: answersParse.errors.map((e) => `${e.code}: ${e.message}`),
    };
  }
  const planResult = buildApplyPlan(answersParse.answers, doc);
  if (!planResult.ok) {
    return {
      kind: 'prepareAutofillResult',
      jobId: req.jobId,
      ok: false,
      errors: planResult.errors.map((e) => `${e.code}: ${e.message}`),
    };
  }
  activeJobs.set(req.jobId, {
    plan: planResult.plan,
    applied: 0,
    total: planResult.plan.steps.length,
    formSpy: null,
    fetchSpy: null,
  });
  return {
    kind: 'prepareAutofillResult',
    jobId: req.jobId,
    ok: true,
    stepCount: planResult.plan.steps.length,
    warnings: planResult.plan.warnings.map((w) => `${w.code}: ${w.message}`),
  };
}

async function handleApply(jobId: string): Promise<ApplyAutofillResult> {
  const job = activeJobs.get(jobId);
  if (!job) {
    return {
      kind: 'applyAutofillResult',
      jobId,
      ok: false,
      applied: 0,
      total: 0,
      errors: ['job not found (reload the page and try again)'],
    };
  }
  // Engage both spies before touching the DOM.
  job.formSpy = installNoSubmitSpy(document);
  job.fetchSpy = installFetchSpy({
    fetchImpl: window.fetch.bind(window),
    target: window,
  });
  const errors: string[] = [];
  let applied = 0;
  for (const step of job.plan.steps) {
    const container = findQuestionContainer(document, step.questionNumber);
    if (!container) {
      errors.push(`step ${step.questionNumber}: question container not found in DOM`);
      break;
    }
    const result = applyStep({ root: container, step });
    if (!result.ok) {
      errors.push(`${result.error.code}: ${result.error.message}`);
      break;
    }
    applied += 1;
    job.applied = applied;
  }
  // Disengage the fetch-spy; the form-spy stays engaged until the user
  // explicitly submits or cancels.
  job.fetchSpy?.uninstall();
  return {
    kind: 'applyAutofillResult',
    jobId,
    ok: errors.length === 0,
    applied,
    total: job.plan.steps.length,
    errors: errors.length > 0 ? errors : undefined,
  };
}

function handleAbort(jobId: string): void {
  const job = activeJobs.get(jobId);
  if (!job) return;
  job.formSpy?.uninstall();
  job.fetchSpy?.uninstall();
  activeJobs.delete(jobId);
}

function findQuestionContainer(doc: Document, questionNumber: number): HTMLElement | null {
  const blocks = Array.from(doc.querySelectorAll<HTMLElement>('.que'));
  for (const el of blocks) {
    const qno = el.querySelector('.qno')?.textContent?.trim() ?? '';
    const match = qno.match(/(\d+)/);
    if (match && Number.parseInt(match[1]!, 10) === questionNumber) {
      return el;
    }
  }
  return null;
}

// Reference unused helper to satisfy the type-checker when consumers strip
// the message types (they're documented in `runtime-messages.ts`).
void ({} as QuizDocumentMessage);