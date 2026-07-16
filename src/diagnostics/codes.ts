// src/diagnostics/codes.ts
//
// Stable, grep-friendly error code taxonomy. From T15 §Diagnóstico:
//   MQX-DETECT-001  no #responseform
//   MQX-PAGE-002    page redirected to login
//   MQX-PARSE-101   question type not supported
//   MQX-ASSET-201   asset MIME not allowed
//   MQX-FILL-301    letter does not exist
//   MQX-FILL-302    control did not confirm the change
//   MQX-PRIV-401    redactor detected a residual secret
//
// Plus implementation-internal codes (prefix MQX-).

export const MQX = {
  // detect stage
  DETECT_NO_FORM: 'MQX-DETECT-001',
  DETECT_LOGIN: 'MQX-PAGE-002',
  DETECT_NOT_QUIZ: 'MQX-DETECT-002',
  DETECT_SUMMARY: 'MQX-DETECT-003',
  DETECT_UNSUPPORTED_LAYOUT: 'MQX-DETECT-004',

  // parse stage
  PARSE_UNKNOWN: 'MQX-PARSE-101',
  PARSE_NOT_IMPLEMENTED: 'MQX-PARSE-102',
  PARSE_INVALID_LETTER: 'MQX-PARSE-103',
  PARSE_NO_VISIBLE_CONTROL: 'MQX-PARSE-104',

  // asset stage
  ASSET_MIME_DENIED: 'MQX-ASSET-201',
  ASSET_TOO_LARGE: 'MQX-ASSET-202',
  ASSET_NETWORK: 'MQX-ASSET-203',
  ASSET_REDIRECT_LOGIN: 'MQX-ASSET-204',

  // autofill stage
  FILL_LETTER_NOT_FOUND: 'MQX-FILL-301',
  FILL_CONTROL_NOT_CONFIRMED: 'MQX-FILL-302',
  FILL_HIDDEN_TOUCHED: 'MQX-FILL-303',
  FILL_SUBMIT_BLOCKED: 'MQX-FILL-304',
  // Phase 3 additions: extended no-submit invariant (fetch spy) and the
  // job machine. The numbering continues after 304 without renumbering
  // existing entries (the existing codes are referenced by tests and
  // fixtures).
  FILL_FETCH_BLOCKED: 'MQX-FILL-305',
  FILL_JOB_EXPIRED: 'MQX-FILL-306',
  FILL_FINGERPRINT_MISMATCH: 'MQX-FILL-307',
  FILL_UNSUPPORTED_STRICT: 'MQX-FILL-308',
  FILL_CONTROL_NOT_CONFIRMED_POST: 'MQX-FILL-309',

  // page / pagination stage
  PAGE_LAYOUT_UNRECOGNIZED: 'MQX-PAGE-005',
  PAGE_NAVIGATION_SKIPPED: 'MQX-PAGE-006',

  // privacy
  PRIV_LEAK_BLOCKED: 'MQX-PRIV-401',
} as const;

export type MqxCode = (typeof MQX)[keyof typeof MQX];
