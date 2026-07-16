// entrypoints/content.ts (overwrites the stub from PR #1)
//
// Detects Moodle quiz attempt pages and reports the result via a
// runtime.sendMessage to the background script. Real extraction and
// autofill arrive in subsequent PRs.

import { createDomAdapter } from '~/moodle/dom-adapter';
import { detectMoodleAttempt, type MoodleDetectionResult } from '~/moodle/detector';

export default defineContentScript({
  matches: ['*://*/*mod/quiz/attempt.php*'],
  runAt: 'document_idle',
  main() {
    const dom = createDomAdapter(document);
    const result: MoodleDetectionResult = detectMoodleAttempt(dom);
    // eslint-disable-next-line no-console
    console.log('[moodle-quiz-extractor] detection', result);
    // Background receives the verdict and decides whether to surface UI
    // (popup, workspace tab, in-page panel). Real messaging arrives with
    // the Zod-validated schemas in PR #4.
    if (typeof browser !== 'undefined' && browser?.runtime?.sendMessage) {
      browser.runtime.sendMessage({ kind: 'detection', result }).catch(() => {
        // background may be down on first install; ignore.
      });
    }
  },
});
