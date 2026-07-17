// tests/unit/fixture-sanitizer.spec.ts

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { sanitizeFixtureHtml, FixtureSanitizationError } from '~/diagnostics/fixture-sanitizer';

// We need jsdom's DOMParser/XMLSerializer in the test environment.
// Vitest already provides jsdom 29; we explicitly install it here so
// the sanitizer has DOMParser/XMLSerializer on globalThis.
const dom = new JSDOM('');
(globalThis as { DOMParser?: typeof DOMParser }).DOMParser = dom.window.DOMParser;
(globalThis as { XMLSerializer?: typeof XMLSerializer }).XMLSerializer =
  dom.window.XMLSerializer;

describe('sanitizeFixtureHtml', () => {
  it('rejects empty input', () => {
    expect(() => sanitizeFixtureHtml('')).toThrow(FixtureSanitizationError);
  });

  it('removes script tags and inline handlers', () => {
    const html = `<html><body>
      <p onclick="evil()">hello</p>
      <script>alert(1)</script>
    </body></html>`;
    const out = sanitizeFixtureHtml(html);
    expect(out.html).not.toMatch(/<script/i);
    expect(out.html).not.toMatch(/onclick=/i);
    expect(out.html).toContain('hello');
    expect(out.droppedTags).toBeGreaterThan(0);
  });

  it('strips iframe / object / embed / style / link', () => {
    const html = `<html><head><style>p{color:red}</style><link rel="stylesheet" href="evil.css"></head><body>
      <iframe src="evil.html"></iframe>
      <object data="evil"></object>
      <embed src="evil.swf">
      <p>visible</p>
    </body></html>`;
    const out = sanitizeFixtureHtml(html);
    expect(out.html).not.toMatch(/<iframe/i);
    expect(out.html).not.toMatch(/<object/i);
    expect(out.html).not.toMatch(/<embed/i);
    expect(out.html).not.toMatch(/<style/i);
    expect(out.html).not.toMatch(/<link/i);
    expect(out.html).toContain('visible');
  });

  it('replaces URLs with placeholders', () => {
    const html = `<html><body><a href="https://moodle.example/mod/quiz/attempt.php?attempt=42">link</a><img src="https://moodle.example/img.png"></body></html>`;
    const out = sanitizeFixtureHtml(html);
    expect(out.html).toContain('__REDACTED__');
    expect(out.html).not.toContain('attempt=42');
  });

  it('replaces id/name/for with placeholders', () => {
    const html = `<html><body><label for="q123_abc">Q</label><input name="q123:1_answer1" id="q123-1"></body></html>`;
    const out = sanitizeFixtureHtml(html);
    expect(out.html).toContain('for="__REDACTED__"');
    expect(out.html).toContain('name="__REDACTED__"');
    expect(out.html).toContain('id="__REDACTED__"');
  });

  it('disables form submits and buttons', () => {
    const html = `<html><body><form action="/submit"><input type="submit" value="Go"><button>X</button></form></body></html>`;
    const out = sanitizeFixtureHtml(html);
    expect(out.html).not.toMatch(/action="[^"]+"/);
    expect(out.html).toContain('disabled="disabled"');
    expect(out.html).toContain('onsubmit="return false"');
  });

  it('removes data attributes carrying sensitive markers', () => {
    const html = `<html><body><div data-attempt="42" data-q="foo" data-allowed="ok">x</div></body></html>`;
    const out = sanitizeFixtureHtml(html);
    expect(out.html).not.toMatch(/data-attempt=/);
    expect(out.html).not.toMatch(/data-q=/);
    expect(out.html).toContain('data-allowed');
  });

  it('reports non-zero bytes for a real HTML', () => {
    const html = `<html><body><p>Hola</p></body></html>`;
    const out = sanitizeFixtureHtml(html);
    expect(out.bytes).toBeGreaterThan(0);
  });
});
