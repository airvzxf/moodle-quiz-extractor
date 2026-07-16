// Content script: stub for PR #1.
// Real detector and parser are added in PR #2 (feat/parser-radio-checkbox).

export default defineContentScript({
  matches: ['*://*/*mod/quiz/attempt.php*'],
  runAt: 'document_idle',
  main() {
    // eslint-disable-next-line no-console
    console.log('[moodle-quiz-extractor] content script loaded');
  },
});
