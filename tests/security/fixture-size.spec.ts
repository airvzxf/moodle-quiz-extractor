// tests/security/fixture-size.spec.ts
//
// Bundle byte-size cap is enforced.

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { buildFixtureBundle, FixtureBundleError } from '~/diagnostics/fixture-builder';
import { RingBufferLogger } from '~/diagnostics/logger';

const dom = new JSDOM('');
(globalThis as { DOMParser?: typeof DOMParser }).DOMParser = dom.window.DOMParser;
(globalThis as { XMLSerializer?: typeof XMLSerializer }).XMLSerializer =
  dom.window.XMLSerializer;

describe('fixture size cap', () => {
  it('rejects sanitized payloads above 5 MiB', () => {
    const payload = 'a'.repeat(6 * 1024 * 1024);
    const html = `<html><body><pre>${payload}</pre></body></html>`;
    expect(() =>
      buildFixtureBundle({
        rawHtml: html,
        safeReportInput: {
          ring: RingBufferLogger.empty(),
          generatorVersion: '0.4.0',
          manifestVersion: 3,
        },
      }),
    ).toThrow(FixtureBundleError);
  });
});
