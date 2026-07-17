// src/diagnostics/fixture-builder.ts
//
// \`buildFixtureBundle\` composes the opt-in debug bundle:
//
//   safe-report.json    - safe report (already redacted by PR 4.1)
//   fixture.html        - sanitized + redacted HTML snapshot
//
// Output: a Uint8Array suitable for \`fflate.zipSync\`. The bundle is
// deterministic: filename derives from SHA-256 of the sanitized HTML.

import { zipSync, strToU8 } from 'fflate';
import { buildSafeReport, type BuildSafeReportInput } from '~/diagnostics/safe-report';
import {
  redactFixtureHtml,
  FixtureRedactionError,
} from '~/diagnostics/fixture-redactor';
import {
  sanitizeFixtureHtml,
  type SanitizedFixture,
} from '~/diagnostics/fixture-sanitizer';
import type { SafeReport } from '~/diagnostics/diagnostics-types';

const MAX_FIXTURE_BYTES = 5 * 1024 * 1024;

export class FixtureBundleError extends Error {
  readonly code:
    | 'sanitization-failed'
    | 'redaction-failed'
    | 'size-exceeded'
    | 'empty';
  constructor(
    code: 'sanitization-failed' | 'redaction-failed' | 'size-exceeded' | 'empty',
    message: string,
  ) {
    super(message);
    this.name = 'FixtureBundleError';
    this.code = code;
  }
}

export interface BuildFixtureBundleInput {
  readonly rawHtml: string;
  readonly safeReportInput: BuildSafeReportInput;
}

export interface FixtureBundleResult {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly safeReport: SafeReport;
  readonly sanitized: SanitizedFixture;
  readonly redactedHits: number;
}

export function buildFixtureBundle(input: BuildFixtureBundleInput): FixtureBundleResult {
  const sanitized = sanitizeFixtureHtml(input.rawHtml);
  if (sanitized.bytes > MAX_FIXTURE_BYTES) {
    throw new FixtureBundleError(
      'size-exceeded',
      `fixture exceeds ${MAX_FIXTURE_BYTES} bytes (got ${sanitized.bytes})`,
    );
  }
  let redacted;
  try {
    redacted = redactFixtureHtml(sanitized.html);
  } catch (err) {
    if (err instanceof FixtureRedactionError) {
      throw new FixtureBundleError(
        'redaction-failed',
        `redaction failed: ${err.label}`,
      );
    }
    throw new FixtureBundleError(
      'redaction-failed',
      err instanceof Error ? err.message : 'redaction failed',
    );
  }
  if (redacted.html.length === 0) {
    throw new FixtureBundleError('empty', 'redacted fixture is empty');
  }
  const safeReport = buildSafeReport(input.safeReportInput);
  const files: Record<string, Uint8Array> = {
    'safe-report.json': strToU8(JSON.stringify(safeReport, null, 2)),
    'fixture.html': strToU8(redacted.html),
  };
  const zipped = zipSync(files, { level: 6 });
  const filename = `mqx-debug-${deriveFilenameId(redacted.html)}.zip`;
  return {
    bytes: zipped,
    filename,
    safeReport,
    sanitized,
    redactedHits: redacted.hits,
  };
}

function deriveFilenameId(html: string): string {
  // Deterministic 8-char prefix derived from the HTML content. Uses a
  // tiny FNV-1a hash to avoid pulling Web Crypto into a code path
  // already executed inside the background SW.
  let hash = 0x811c9dc5;
  for (let i = 0; i < html.length; i += 1) {
    hash ^= html.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 8);
}

export const __testing = {
  MAX_FIXTURE_BYTES,
  deriveFilenameId,
};
