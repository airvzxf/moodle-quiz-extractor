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
  type QuizDocumentMessage,
} from '~/messaging/runtime-messages';
import { redactString } from '~/diagnostics/redactor';
import { MQX } from '~/diagnostics/codes';
import type { DiagnosticsEventInput } from '~/diagnostics/diagnostics-types';
import {
  CollectDiagnosticsRequestSchema,
  type CollectDiagnosticsRequest,
  GetFixtureSnapshotRequestSchema,
  FixtureSnapshotResultSchema,
  type FixtureSnapshotResult,
  SafeReportResultSchema,
  type SafeReportResult,
} from '~/messaging/runtime-messages';
import type { SafeReport } from '~/diagnostics/diagnostics-types';

interface AutofillJobState {
  plan: import('~/autofill/apply-plan').ApplyPlan;
  applied: number;
  total: number;
  formSpy: ReturnType<typeof installNoSubmitSpy> | null;
  fetchSpy: ReturnType<typeof installFetchSpy> | null;
}

const activeJobs = new Map<string, AutofillJobState>();

function emit(
  input: DiagnosticsEventInput,
  senderTabId: number | undefined,
): void {
  // The background SW is the only consumer of these events. It stamps
  // `ts` and derives `tabId` from `sender.tab`, so the content script
  // must NOT set either field. Sending from the content script means
  // `sender.tab.id` is always present in MV3, but defensively fall
  // back to `0` if not.
  if (typeof browser === 'undefined' || !browser.runtime?.sendMessage) return;
  void browser.runtime
    .sendMessage({
      kind: 'logDiagnosticsEvent',
      tabId: senderTabId ?? 0,
      input,
    })
    .catch(() => {
      // Fire-and-forget. Failure to deliver must not break the user
      // flow; the diagnostics ring is best-effort.
    });
}

export default defineContentScript({
  matches: ['*://*/*mod/quiz/attempt.php*'],
  runAt: 'document_idle',
  main() {
    // eslint-disable-next-line no-console
    console.log('[moodle-quiz-extractor] content script loaded');

    browser.runtime.onMessage.addListener(
      (raw: unknown, sender, sendResponse: (response: unknown) => void) => {
        // Note: `zipQuiz` is NOT handled here. The popup sends it directly
        // to the background (with `tabUrl` captured from the active tab).
        // If this content script also re-forwarded it, the background
        // would run the ZIP pipeline twice and the user would get two
        // downloads.
        const req = QuizExtractRequestSchema.safeParse(raw);
        if (req.success) {
          void handleExtract(sender?.tab?.id)
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
        const prep = PrepareAutofillRequestSchema.safeParse(raw);
        if (prep.success) {
          void handlePrepare(prep.data, sender?.tab?.id)
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
          void handleApply(apply.data.jobId, sender?.tab?.id)
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
        const collect = CollectDiagnosticsRequestSchema.safeParse(raw);
        if (collect.success) {
          const reqTyped: CollectDiagnosticsRequest = collect.data;
          void forwardCollectToBackground(reqTyped, sender?.tab?.id ?? 0)
            .then((report) => {
              const result: SafeReportResult = {
                kind: 'safeReportResult',
                ok: true,
                report,
              };
              sendResponse(result);
            })
            .catch((err: Error) => {
              const result: SafeReportResult = {
                kind: 'safeReportResult',
                ok: false,
                error: err.message,
              };
              sendResponse(SafeReportResultSchema.parse(result));
            });
          return true;
        }
        const fixture = GetFixtureSnapshotRequestSchema.safeParse(raw);
        if (fixture.success) {
          try {
            const html =
              document.documentElement && document.documentElement.outerHTML
                ? document.documentElement.outerHTML
                : '';
            const result: FixtureSnapshotResult = FixtureSnapshotResultSchema.parse({
              kind: 'fixtureSnapshotResult',
              ok: true,
              html,
            });
            sendResponse(result);
          } catch (err) {
            const result: FixtureSnapshotResult = FixtureSnapshotResultSchema.parse({
              kind: 'fixtureSnapshotResult',
              ok: false,
              error: err instanceof Error ? err.message : 'snapshot failed',
            });
            sendResponse(result);
          }
          return true;
        }
        return false;
      },
    );
  },
});

async function forwardCollectToBackground(
  req: CollectDiagnosticsRequest,
  tabId: number,
): Promise<SafeReport> {
  void req;
  const res = await browser.runtime.sendMessage({
    kind: 'collectDiagnostics',
    tabId,
  });
  const parsed = SafeReportResultSchema.safeParse(res);
  if (!parsed.success || !parsed.data.ok || !parsed.data.report) {
    throw new Error(parsed.data?.error ?? 'safe report unavailable');
  }
  return parsed.data.report;
}

async function handleExtract(senderTabId: number | undefined) {
  const dom = createDomAdapter(document);
  const result = detectMoodleAttempt(dom);
  if (result.kind !== 'supported') {
    const code =
      result.kind === 'expiredSession'
        ? MQX.DETECT_LOGIN
        : result.kind === 'finishedAttempt'
          ? MQX.DETECT_SUMMARY
          : result.kind === 'unsupportedLayout'
            ? MQX.DETECT_UNSUPPORTED_LAYOUT
            : MQX.DETECT_NOT_QUIZ;
    emit({ schemaVersion: '1.0', stage: 'detect', code }, senderTabId);
    throw new Error(`cannot extract: ${result.kind}/${'reason' in result ? result.reason : ''}`);
  }
  const warns: Array<{ code: string; stage: 'parse'; message: string }> = [];
  const questions = await Promise.all(
    dom.listQuestions().map((q) =>
      parseQuestion(q, {
        fingerprint,
        warn: (code, message) => {
          warns.push({ code, stage: 'parse', message });
          emit({ schemaVersion: '1.0', stage: 'parse', code: MQX.PARSE_UNKNOWN }, senderTabId);
        },
      }),
    ),
  );
  return buildQuizDocument(dom, questions, warns);
}

async function handlePrepare(
  req: PrepareAutofillRequest,
  senderTabId: number | undefined,
): Promise<PrepareAutofillResult> {
  const dom = createDomAdapter(document);
  const detected = detectMoodleAttempt(dom);
  if (detected.kind !== 'supported') {
    const code =
      detected.kind === 'expiredSession'
        ? MQX.DETECT_LOGIN
        : detected.kind === 'finishedAttempt'
          ? MQX.DETECT_SUMMARY
          : detected.kind === 'unsupportedLayout'
            ? MQX.DETECT_UNSUPPORTED_LAYOUT
            : MQX.DETECT_NOT_QUIZ;
    emit({ schemaVersion: '1.0', stage: 'detect', code }, senderTabId);
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
        warn: (code, message) => {
          warns.push({ code, stage: 'parse', message });
          emit({ schemaVersion: '1.0', stage: 'parse', code: MQX.PARSE_UNKNOWN }, senderTabId);
        },
      }),
    ),
  );
  const doc = await buildQuizDocument(dom, questions, warns);

  const answersParse = parseAnswerList(redactString(req.answersText));
  if (!answersParse.ok) {
    emit(
      {
        schemaVersion: '1.0',
        stage: 'parse',
        code: MQX.PARSE_INVALID_LETTER,
      },
      senderTabId,
    );
    return {
      kind: 'prepareAutofillResult',
      jobId: req.jobId,
      ok: false,
      errors: answersParse.errors.map((e) => `${e.code}: ${e.message}`),
    };
  }
  const planResult = buildApplyPlan(answersParse.answers, doc);
  if (!planResult.ok) {
    for (const e of planResult.errors) {
      emit(
        {
          schemaVersion: '1.0',
          stage: 'fill',
          code: (e.code as typeof MQX.FILL_LETTER_NOT_FOUND) ?? MQX.FILL_LETTER_NOT_FOUND,
        },
        senderTabId,
      );
    }
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
  emit(
    {
      schemaVersion: '1.0',
      stage: 'fill',
      code: MQX.FILL_FINGERPRINT_MISMATCH,
    },
    senderTabId,
  );
  return {
    kind: 'prepareAutofillResult',
    jobId: req.jobId,
    ok: true,
    stepCount: planResult.plan.steps.length,
    warnings: planResult.plan.warnings.map((w) => `${w.code}: ${w.message}`),
  };
}

async function handleApply(jobId: string, senderTabId: number | undefined): Promise<ApplyAutofillResult> {
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
  emit({ schemaVersion: '1.0', stage: 'fill', code: MQX.FILL_FETCH_BLOCKED }, senderTabId);
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
      emit(
        {
          schemaVersion: '1.0',
          stage: 'fill',
          code: MQX.FILL_FINGERPRINT_MISMATCH,
          questionNumber: step.questionNumber,
        },
        senderTabId,
      );
      errors.push(`step ${step.questionNumber}: question container not found in DOM`);
      break;
    }
    const result = applyStep({ root: container, step });
    if (!result.ok) {
      emit(
        {
          schemaVersion: '1.0',
          stage: 'fill',
          code: MQX.FILL_CONTROL_NOT_CONFIRMED,
          questionNumber: step.questionNumber,
        },
        senderTabId,
      );
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