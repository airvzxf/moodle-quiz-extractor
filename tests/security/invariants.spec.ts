// Invariantes de seguridad comprobados sobre el código fuente y la configuración.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import config, { MANIFEST_PERMISSIONS } from '../../wxt.config';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}
const SOURCES = sourceFiles(join(process.cwd(), 'src')).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

describe('invariantes de seguridad', () => {
  it.each([
    ['enviar formularios', /\.submit\s*\(|requestSubmit/],
    ['llamar a processattempt.php o finishattempt', /processattempt|finishattempt/],
    ['usar storage.sync o storage.local', /storage\.(sync|local)/],
    ['escribir HTML sin escapar', /\.innerHTML|\.outerHTML\s*=|insertAdjacentHTML|document\.write/],
    ['evaluar código', /\beval\s*\(|new Function\s*\(/],
    ['pedir acceso a todos los sitios', /<all_urls>/],
  ])('el código nunca puede %s', (_what, pattern) => {
    const offenders = SOURCES.filter((f) => pattern.test(f.text)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('el manifiesto pide sólo activeTab, scripting, storage y downloads, sin host_permissions', () => {
    expect([...MANIFEST_PERMISSIONS].sort()).toEqual(['activeTab', 'downloads', 'scripting', 'storage']);
    const manifest = config.manifest as Record<string, unknown>;
    expect(manifest.permissions).toBe(MANIFEST_PERMISSIONS);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.optional_host_permissions).toBeUndefined();
    expect(manifest.content_scripts).toBeUndefined();
  });

  it('Firefox declara que no recoge datos', () => {
    const manifest = config.manifest as { browser_specific_settings: { gecko: Record<string, unknown> } };
    expect(manifest.browser_specific_settings.gecko.data_collection_permissions).toEqual({ required: ['none'] });
  });
});
