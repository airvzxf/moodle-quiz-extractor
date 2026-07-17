// tests/security/fixture-leak.spec.ts
//
// Security gating: the fixture bundle must NEVER leak canary patterns
// even when the input HTML carries hostile tokens.

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { unzipSync, strFromU8 } from 'fflate';
import { buildFixtureBundle } from '~/diagnostics/fixture-builder';
import { RingBufferLogger } from '~/diagnostics/logger';
import { findCanaryLeaks } from '~/diagnostics/canary-patterns';

const dom = new JSDOM('');
(globalThis as { DOMParser?: typeof DOMParser }).DOMParser = dom.window.DOMParser;
(globalThis as { XMLSerializer?: typeof XMLSerializer }).XMLSerializer =
  dom.window.XMLSerializer;

describe('fixture bundle leak gating', () => {
  it('strips every canary pattern even with hostile input', () => {
    const hostile = `<html><body>
      <a href="https://moodle.example/mod/quiz/attempt.php?attempt=42&sesskey=eLDsS5Y5jR&cmid=999">link</a>
      <img src="https://moodle.example/img.png?MoodleSession=abcdef0123456789">
      <form action="/processattempt.php"><input type="submit"></form>
      <input name="q123:1_answer1" id="q123-1" value="sesskey=stealthy123">
      <p>contacto: student@example.edu</p>
      <p>checksum aabbccddeeff00112233445566778899aabbccdd</p>
      <iframe srcdoc="sesskey=inside"></iframe>
      <style>body { background: url('sesskey=moreleak'); }</style>
      <script>sesskey=scriptleak</script>
      <p>visible</p>
    </body></html>`;
    const out = buildFixtureBundle({
      rawHtml: hostile,
      safeReportInput: {
        ring: RingBufferLogger.empty(),
        generatorVersion: '0.4.0',
        manifestVersion: 3,
      },
    });
    const files = unzipSync(out.bytes);
    const fixtureHtml = strFromU8(files['fixture.html']!);
    const safeReport = strFromU8(files['safe-report.json']!);
    expect(findCanaryLeaks(fixtureHtml)).toEqual([]);
    expect(findCanaryLeaks(safeReport)).toEqual([]);
    expect(fixtureHtml).toContain('visible');
  });
});
