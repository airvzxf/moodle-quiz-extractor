// tests/unit/manifest-icons.spec.ts
//
// Verifies that the manifest emitted by `pnpm build:firefox` declares
// both `icons` and `action.default_icon`, and that the referenced
// PNG files exist in the build output.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), '.output', 'firefox-mv3');
const skip = !existsSync(OUT);

const runIfBuilt = skip ? describe.skip : describe;

runIfBuilt('build manifest: icons', () => {
  it('manifest.json exists and parses as JSON', () => {
    const text = readFileSync(join(OUT, 'manifest.json'), 'utf8');
    const m = JSON.parse(text) as Record<string, unknown>;
    expect(m['manifest_version']).toBe(3);
  });

  it('manifest declares icons at 16/32/48/64/128', () => {
    const m = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8')) as {
      icons?: Record<string, string>;
    };
    expect(m.icons).toBeTruthy();
    expect(Object.keys(m.icons ?? {}).sort()).toEqual(['128', '16', '32', '48', '64']);
    for (const [size, path] of Object.entries(m.icons ?? {})) {
      const abs = join(OUT, path);
      expect(existsSync(abs), `icon ${size} (${path})`).toBe(true);
      const s = statSync(abs);
      expect(s.size).toBeGreaterThan(0);
    }
  });

  it('action.default_icon references toolbar-sized icons', () => {
    const m = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8')) as {
      action?: { default_icon?: Record<string, string> };
    };
    expect(m.action?.default_icon).toBeTruthy();
    const keys = Object.keys(m.action?.default_icon ?? {});
    expect(keys).toContain('32');
  });

  it('no cookies permission is declared', () => {
    const m = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8')) as {
      permissions?: string[];
    };
    expect(m.permissions ?? []).not.toContain('cookies');
  });
});
