// tests/unit/zip-packager.spec.ts
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildZip } from '~/export/zip';

describe('ZipPackager (fflate)', () => {
  const PNG_BYTES = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
    0x48, 0x44, 0x52,
  ]);

  it('produces a non-empty archive with the expected entries', () => {
    const out = buildZip({
      markdown: '# Quiz\n\nmarkdown body',
      json: '{"schemaVersion":"1.0"}',
      manifest: '{"schemaVersion":"1.0"}',
      assets: new Map(),
    });
    expect(out.byteLength).toBeGreaterThan(0);
    // 0x50 0x4B = "PK" local file header signature
    expect(out[0]).toBe(0x50);
    expect(out[1]).toBe(0x4b);

    const files = unzipSync(out);
    expect(Object.keys(files).sort()).toEqual([
      'README.txt',
      'manifest.json',
      'quiz.json',
      'quiz.md',
    ]);
    expect(strFromU8(files['quiz.md']!)).toContain('markdown body');
    expect(JSON.parse(strFromU8(files['quiz.json']!))).toEqual({
      schemaVersion: '1.0',
    });
    expect(strFromU8(files['README.txt']!)).toContain('moodle-quiz-extractor');
  });

  it('embeds asset bytes at the requested localPath', () => {
    const out = buildZip({
      markdown: '# Quiz',
      json: '{}',
      manifest: '{}',
      assets: new Map([['quiz/q1-abcdef01.png', PNG_BYTES]]),
    });
    const files = unzipSync(out);
    const asset = files['quiz/q1-abcdef01.png'];
    expect(asset).toBeDefined();
    expect(Array.from(asset!)).toEqual(Array.from(PNG_BYTES));
  });

  it('embeds multiple assets, preserving bytes exactly', () => {
    const a = new Uint8Array([0x01, 0x02, 0x03]);
    const b = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]);
    const out = buildZip({
      markdown: '# Quiz',
      json: '{}',
      manifest: '{}',
      assets: new Map([
        ['quiz/q1-a.png', a],
        ['quiz/q2-b.jpg', b],
      ]),
    });
    const files = unzipSync(out);
    expect(Array.from(files['quiz/q1-a.png']!)).toEqual(Array.from(a));
    expect(Array.from(files['quiz/q2-b.jpg']!)).toEqual(Array.from(b));
  });

  it('rejects asset paths that try to escape the archive root', () => {
    expect(() =>
      buildZip({
        markdown: '',
        json: '',
        manifest: '{}',
        assets: new Map([['../escape.txt', new Uint8Array([1])]]),
      }),
    ).toThrowError(/escapes archive root/);
    expect(() =>
      buildZip({
        markdown: '',
        json: '',
        manifest: '{}',
        assets: new Map([['/abs.txt', new Uint8Array([1])]]),
      }),
    ).toThrowError(/escapes archive root/);
  });

  it('throws if any of the strings contain a canary leak', () => {
    expect(() =>
      buildZip({
        markdown: '?sesskey=abcDEF123',
        json: '',
        manifest: '{}',
        assets: new Map(),
      }),
    ).toThrowError(/MQX-PRIV-401/);
  });

  it('round-trips a fixture-style ZIP end to end', () => {
    const md = '# Title\n\nbody\n';
    const json = '{"x":1}';
    const manifest = '{"y":2}';
    const out = buildZip({
      markdown: md,
      json,
      manifest,
      assets: new Map(),
    });
    const files = unzipSync(out);
    // Markdown is redaction-clean and round-trips byte-exact.
    expect(strFromU8(files['quiz.md']!)).toBe(md);
    // JSON inputs are parsed and re-serialized with 2-space indentation to
    // guarantee deterministic output. Compare parsed values instead of bytes.
    expect(JSON.parse(strFromU8(files['quiz.json']!))).toEqual({ x: 1 });
    expect(JSON.parse(strFromU8(files['manifest.json']!))).toEqual({ y: 2 });
  });
});