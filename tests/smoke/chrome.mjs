// Prueba de humo en Chromium con la extensión real compilada (WXT_SMOKE=1).
// Uso: pnpm smoke:chrome   (variable opcional CHROMIUM_PATH)
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { chromium } from 'playwright-core';
import { PNG, SESSION_COOKIE, startFakeMoodle } from './fake-moodle.mjs';

const EXTENSION_DIR = realpathSync(join(process.cwd(), '.output-smoke', 'chrome-mv3'));
const CANDIDATES = [process.env.CHROMIUM_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable'];
const executablePath = CANDIDATES.find((p) => p && existsSync(p));
if (!executablePath) throw new Error('No se encontró Chromium; define CHROMIUM_PATH.');

// Id de una extensión desempaquetada: SHA-256 de su ruta absoluta, 32 nibbles → a..p.
const extensionId = [...createHash('sha256').update(EXTENSION_DIR).digest('hex').slice(0, 32)]
  .map((c) => String.fromCharCode(97 + Number.parseInt(c, 16)))
  .join('');

function check(condition, message) {
  if (!condition) throw new Error(`FALLO: ${message}`);
  console.log(`ok - ${message}`);
}

const moodle = await startFakeMoodle();
const profile = mkdtempSync(join(tmpdir(), 'mqx-smoke-chrome-'));
const downloads = mkdtempSync(join(tmpdir(), 'mqx-smoke-dl-'));
const context = await chromium.launchPersistentContext(profile, {
  executablePath,
  headless: false,
  acceptDownloads: true,
  downloadsPath: downloads,
  args: [
    '--headless=new',
    `--disable-extensions-except=${EXTENSION_DIR}`,
    `--load-extension=${EXTENSION_DIR}`,
  ],
});

try {
  await context.addCookies([{ ...SESSION_COOKIE, domain: '127.0.0.1', path: '/' }]);
  const page = await context.newPage();
  await page.goto(moodle.attemptUrl);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html?target=${encodeURIComponent('http://127.0.0.1/mod/quiz/attempt.php*')}`);

  await popup.waitForFunction(() => document.getElementById('status')?.textContent?.includes('Página 1 de 2'));
  check(true, 'el popup reconoce el intento y sus 2 páginas');

  const download = context.waitForEvent('download', { timeout: 20_000 }).catch(() => null);
  await popup.click('#export-btn');
  await popup.waitForFunction(() => /Listo|No se pudo/.test(document.getElementById('export-result')?.textContent ?? ''));
  const result = await popup.textContent('#export-result');
  check(result?.startsWith('Listo: 10 preguntas'), `exporta las 10 preguntas de las 2 páginas (${result})`);

  const event = await download;
  let zipPath = event ? await event.path() : null;
  if (!zipPath) {
    const found = readdirSync(downloads).map((f) => join(downloads, f));
    zipPath = found[0] ?? null;
  }
  check(zipPath !== null, 'el ZIP se descargó');
  const files = unzipSync(new Uint8Array(readFileSync(zipPath)));
  const names = Object.keys(files);
  const md = strFromU8(files[names.find((n) => n.endsWith('/quiz.md'))]);
  const json = JSON.parse(strFromU8(files[names.find((n) => n.endsWith('/quiz.json'))]));
  const png = files[names.find((n) => n.endsWith('/quiz/A2_Examen_U1.png'))];
  check((md.match(/^### \d+\. /gm) ?? []).length === 10, 'quiz.md tiene 10 preguntas');
  check(JSON.stringify(json.pages) === '[0,1]', 'quiz.json incluye las páginas 0 y 1');
  check(png !== undefined && Buffer.from(png).equals(PNG), 'la imagen se descargó con la sesión de la página');
  check(moodle.log.gets.some((g) => g.includes('page=1')), 'la página 2 se pidió con GET');

  await popup.fill('#answers', '1. a, c\n2. c\n7. b');
  await popup.click('#apply-btn');
  await popup.waitForFunction(() => (document.getElementById('fill-result')?.textContent ?? '') !== '');
  const fill = await popup.textContent('#fill-result');
  check(fill === 'Aplicadas en esta página: 1, 2.', `autollenado aplica las de esta página (${fill})`);
  const messages = await popup.textContent('#fill-messages');
  check(messages?.includes('Pregunta 7: está en la página 2.'), 'avisa que la 7 está en la página 2');
  const state = await page.evaluate(() =>
    ['q13963:10_choice0', 'q13963:10_choice2', 'q13963:2_answer2'].map((id) => document.getElementById(id).checked),
  );
  check(state.every(Boolean), 'los controles quedaron marcados en la página');

  await context.clearCookies();
  await popup.click('#export-btn');
  await popup.waitForFunction(() => /Listo: 5|No se pudo/.test(document.getElementById('export-result')?.textContent ?? ''));
  const warnings = await popup.textContent('#export-warnings');
  check(warnings?.includes('No se pudo leer la página 2.'), 'sin sesión, la página 2 cuenta como no disponible');

  check(moodle.log.posts.length === 0, 'la extensión nunca hizo POST (nunca envió el intento)');
  console.log('SMOKE CHROME OK');
} finally {
  await context.close();
  await moodle.close();
  for (const dir of [profile, downloads]) {
    if (dir.startsWith(tmpdir())) rmSync(dir, { recursive: true, force: true });
  }
}
