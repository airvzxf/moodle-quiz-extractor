// tests/unit/fixture-builder.spec.ts

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { unzipSync, strFromU8 } from 'fflate';
import { buildFixtureBundle, FixtureBundleError, __testing } from '~/diagnostics/fixture-builder';
import { RingBufferLogger } from '~/diagnostics/logger';
import { findCanaryLeaks } from '~/diagnostics/canary-patterns';

const dom = new JSDOM('');
(globalThis as { DOMParser?: typeof DOMParser }).DOMParser = dom.window.DOMParser;
(globalThis as { XMLSerializer?: typeof XMLSerializer }).XMLSerializer =
  dom.window.XMLSerializer;

function ring(): RingBufferLogger {
  const r = RingBufferLogger.empty();
  return r;
}

describe('buildFixtureBundle', () => {
  it('produces a deterministic filename', () => {
    const html = '<html><body><p>hola</p></body></html>';
    const a = buildFixtureBundle({
      rawHtml: html,
      safeReportInput: { ring: ring(), generatorVersion: '0.4.0', manifestVersion: 3 },
    });
    const b = buildFixtureBundle({
      rawHtml: html,
      safeReportInput: { ring: ring(), generatorVersion: '0.4.0', manifestVersion: 3 },
    });
    expect(a.filename).toBe(b.filename);
    expect(a.filename).toMatch(/^mqx-debug-[0-9a-f]{8}\.zip$/);
  });

  it('emits exactly two files in the zip', () => {
    const html = '<html><body><p>hello</p></body></html>';
    const out = buildFixtureBundle({
      rawHtml: html,
      safeReportInput: { ring: ring(), generatorVersion: '0.4.0', manifestVersion: 3 },
    });
    const files = unzipSync(out.bytes);
    expect(Object.keys(files).sort()).toEqual(['fixture.html', 'safe-report.json']);
  });

  it('the safe-report.json contains no canary patterns', () => {
    const html = '<html><body><p>ok</p></body></html>';
    const out = buildFixtureBundle({
      rawHtml: html,
      safeReportInput: { ring: ring(), generatorVersion: '0.4.0', manifestVersion: 3 },
    });
    const files = unzipSync(out.bytes);
    const safeReport = strFromU8(files['safe-report.json']!);
    expect(findCanaryLeaks(safeReport)).toEqual([]);
  });

  it('the fixture.html contains no canary patterns', () => {
    const html = `<html><body>
      <a href="https://moodle.example/mod/quiz/attempt.php?attempt=42&sesskey=eLDsS5Y5jR">x</a>
      <img src="https://moodle.example/img.png?cmid=999">
      <p>contacto a student@example.edu</p>
      <input name="q123:1_answer1" id="q123-1">
    </body></html>`;
    const out = buildFixtureBundle({
      rawHtml: html,
      safeReportInput: { ring: ring(), generatorVersion: '0.4.0', manifestVersion: 3 },
    });
    const files = unzipSync(out.bytes);
    const html2 = strFromU8(files['fixture.html']!);
    expect(findCanaryLeaks(html2)).toEqual([]);
  });

  it('rejects empty input', () => {
    expect(() =>
      buildFixtureBundle({
        rawHtml: '',
        safeReportInput: { ring: ring(), generatorVersion: '0.4.0', manifestVersion: 3 },
      }),
    ).toThrow();
  });

  it('exposes MAX_FIXTURE_BYTES = 5 MiB', () => {
    expect(__testing.MAX_FIXTURE_BYTES).toBe(5 * 1024 * 1024);
  });
});
