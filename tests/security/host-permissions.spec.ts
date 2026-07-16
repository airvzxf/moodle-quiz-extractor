// tests/security/host-permissions.spec.ts
//
// Static-analysis test: the manifest must not have grown any new
// `permissions` or `host_permissions` since the v0.2.0 baseline. Phase 3
// (and the wider plan) keeps `<all_urls>` only as `optional_host_permissions`
// and relies on the per-origin runtime grant (`requestAssetPermission`).

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ALLOWED_PERMISSIONS: ReadonlyArray<string> = [
  'activeTab',
  'storage',
  'scripting',
  'downloads',
];
const ALLOWED_HOST_PERMISSIONS: ReadonlyArray<string> = [
  '*://*/*mod/quiz/attempt.php*',
];

describe('manifest invariant — no new permissions', () => {
  it('wxt.config.ts declares only the Phase 2 baseline permissions', async () => {
    const content = await readFile(join(process.cwd(), 'wxt.config.ts'), 'utf8');
    const permsMatch = content.match(/permissions:\s*\[([^\]]+)\]/);
    expect(permsMatch).not.toBeNull();
    const perms = parseList(permsMatch![1]!);
    for (const p of perms) {
      expect(ALLOWED_PERMISSIONS).toContain(p);
    }
  });

  it('host_permissions are scoped to attempt.php only', async () => {
    const content = await readFile(join(process.cwd(), 'wxt.config.ts'), 'utf8');
    const hostMatch = content.match(/host_permissions:\s*\[([^\]]+)\]/);
    expect(hostMatch).not.toBeNull();
    const hosts = parseList(hostMatch![1]!);
    for (const h of hosts) {
      expect(ALLOWED_HOST_PERMISSIONS).toContain(h);
    }
  });

  it('optional_host_permissions still contains <all_urls> fallback (documented)', async () => {
    const content = await readFile(join(process.cwd(), 'wxt.config.ts'), 'utf8');
    expect(content).toMatch(/optional_host_permissions:\s*\[\s*['"]<all_urls>['"]\s*\]/);
  });

  it('does not add the "cookies" permission (would bypass the sandbox)', async () => {
    const content = await readFile(join(process.cwd(), 'wxt.config.ts'), 'utf8');
    expect(content).not.toMatch(/['"]cookies['"]/);
  });
});

function parseList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter((s) => s.length > 0);
}