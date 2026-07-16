// tests/security/storage-no-sync.spec.ts
//
// Static-analysis test: no source file under src/ may import or use
// `browser.storage.sync` (which crosses devices and would leak the
// user's answers outside the local profile). The Fase 3 plan locks
// this down as a merge-gate test.

import { describe, it, expect } from 'vitest';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOT = join(process.cwd(), 'src');
const FORBIDDEN_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /browser\.storage\.sync/, label: 'browser.storage.sync (cross-device)' },
  { pattern: /\bstorage\.sync\b/, label: 'storage.sync literal' },
  { pattern: /\bstorage_sync\b/, label: 'storage_sync snake_case' },
];

async function* walk(dir: string): AsyncIterable<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(full);
    } else if (e.isFile() && e.name.endsWith('.ts')) {
      yield full;
    }
  }
}

function stripComments(text: string): string {
  // Strip block comments.
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('storage invariant — no sync storage', () => {
  it('src/ contains no code reference to storage.sync (comments are stripped)', async () => {
    const hits: Array<{ file: string; line: number; label: string; text: string }> = [];
    for await (const file of walk(ROOT)) {
      const content = await readFile(file, 'utf8');
      const cleaned = stripComments(content);
      const lines = cleaned.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const text = lines[i]!;
        for (const { pattern, label } of FORBIDDEN_PATTERNS) {
          if (pattern.test(text)) {
            hits.push({ file: relative(process.cwd(), file), line: i + 1, label, text });
          }
        }
      }
    }
    if (hits.length > 0) {
      const msg = hits.map((h) => `  ${h.file}:${h.line}  ${h.label}\n    ${h.text}`).join('\n');
      throw new Error(`storage.sync references found:\n${msg}`);
    }
    expect(hits).toEqual([]);
    void stat;
  });

  it('src/background/ has a storage.session adapter and no sync adapter', async () => {
    const dir = join(ROOT, 'background');
    const content = await readFile(join(dir, 'job-store.ts'), 'utf8');
    expect(content).toMatch(/browser\.storage\.session/);
    expect(content).not.toMatch(/browser\.storage\.sync/);
  });
});