// tests/unit/version.spec.ts
//
// Source-of-truth check: package.json#version, the GENERATOR_VERSION
// constant in background.ts, the popup footer, and the manifest
// emitted by `pnpm build:firefox` must all match.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const OUT = join(ROOT, '.output', 'firefox-mv3');
const skip = !existsSync(OUT);

const runIfBuilt = skip ? describe.skip : describe;

function readPkgVersion(): string {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    version: string;
  };
  return pkg.version;
}

function readBackgroundVersion(): string {
  const src = readFileSync(
    join(ROOT, 'src', 'entrypoints', 'background.ts'),
    'utf8',
  );
  const m = src.match(/GENERATOR_VERSION\s*=\s*['"]([^'"]+)['"]/);
  return m?.[1] ?? '';
}

function readPopupVersion(): string {
  const html = readFileSync(join(ROOT, 'src', 'entrypoints', 'popup.html'), 'utf8');
  const m = html.match(/v(\d+\.\d+\.\d+)/);
  return m?.[1] ?? '';
}

function readManifestVersion(): string {
  const text = readFileSync(join(OUT, 'manifest.json'), 'utf8');
  const m = JSON.parse(text) as { version?: string };
  return m.version ?? '';
}

runIfBuilt('version consistency (package.json, background, popup, manifest)', () => {
  it('all four sources agree on the version', () => {
    const pkg = readPkgVersion();
    const bg = readBackgroundVersion();
    const popup = readPopupVersion();
    const manifest = readManifestVersion();
    expect(pkg).toBe(bg);
    expect(pkg).toBe(popup);
    expect(pkg).toBe(manifest);
  });
});
