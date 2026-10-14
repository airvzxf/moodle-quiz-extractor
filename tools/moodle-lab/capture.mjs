#!/usr/bin/env node
// Captura páginas reales del laboratorio Moodle (issue #12) como fixtures.
//
// Inicia sesión como el estudiante del laboratorio, abre cada intento
// (attempt.php, todas sus páginas) y cada revisión (review.php), y guarda
// en tests/fixtures/lab/ sólo las partes que lee la extensión, sin <script>
// ni <style>, con la sesskey y el origen reemplazados. El contenido es inventado
// (questions.xml): no hay datos personales.
//
// Uso: node tools/moodle-lab/capture.mjs   (requiere `lab.sh up`)
// Variables: MQX_LAB_DIR, CHROMIUM_PATH.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { chromium } from 'playwright-core';
import { loginAsStudent } from './login.mjs';

const LAB_DIR = process.env.MQX_LAB_DIR ?? join(homedir(), '.cache', 'mqx-moodle-lab');
const OUT_DIR = join(process.cwd(), 'tests', 'fixtures', 'lab');
const FAKE_ORIGIN = 'https://moodle.example.test';

const seed = JSON.parse(readFileSync(join(LAB_DIR, 'seed.json'), 'utf8'));
const origin = new URL(seed.wwwroot).origin;

const CANDIDATES = [process.env.CHROMIUM_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable'];
const executablePath = CANDIDATES.find((p) => p && existsSync(p));
if (!executablePath) throw new Error('No se encontró Chromium; define CHROMIUM_PATH.');

function clean(raw) {
  const { document } = new JSDOM(raw, { virtualConsole: new VirtualConsole() }).window;
  const sesskey = document.querySelector('input[name="sesskey"]')?.getAttribute('value');
  // Sólo lo que lee la extensión (como tools/make-fixture.mjs): migas de pan,
  // encabezado, contenido principal (formulario del intento o resumen de la
  // revisión) y el bloque de navegación del cuestionario.
  const parts = [
    document.querySelector('ol.breadcrumb')?.closest('nav'),
    document.querySelector('#page-header'),
    document.querySelector('#region-main'),
    document.querySelector('#mod_quiz_navblock'),
  ].filter((el) => el != null);
  for (const el of parts) {
    el.querySelectorAll('script, style, noscript, link').forEach((s) => s.remove());
  }
  const body = document.body;
  const bodyAttrs = ['id', 'class'].map((a) => `${a}="${body.getAttribute(a) ?? ''}"`).join(' ');
  let html = [
    '<!DOCTYPE html>',
    `<html lang="${document.documentElement.lang}"><head><meta charset="utf-8">`,
    `<title>${document.title}</title></head>`,
    `<body ${bodyAttrs}>`,
    ...parts.map((el) => el.outerHTML),
    '</body></html>',
    '',
  ].join('\n');
  if (sesskey) html = html.replaceAll(sesskey, 'SESSKEY');
  const fake = new URL(FAKE_ORIGIN);
  const real = new URL(origin);
  return html
    .replaceAll(origin, FAKE_ORIGIN)
    .replaceAll(encodeURIComponent(origin), encodeURIComponent(FAKE_ORIGIN))
    .replaceAll(origin.replaceAll('/', '\\/'), FAKE_ORIGIN.replaceAll('/', '\\/')) // JSON con barras escapadas
    .replaceAll(`${real.hostname.replaceAll('.', '-')}--${real.port}`, fake.hostname.replaceAll('.', '-')); // clase de <body>
}

const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage();
// El HTML llega completo del servidor; no hace falta esperar CSS ni JS (la
// primera carga tras purgar cachés recompila el tema y tarda).
page.setDefaultTimeout(120_000);
mkdirSync(OUT_DIR, { recursive: true });
/** nombre → URL con la que se abrió (origen ficticio), para los tests. */
const manifest = {};

async function save(name, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (new URL(page.url()).pathname !== new URL(url).pathname) {
    throw new Error(`${name}: Moodle redirigió a ${page.url()}`);
  }
  writeFileSync(join(OUT_DIR, `${name}.html`), clean(await page.content()));
  manifest[name] = url.replace(origin, FAKE_ORIGIN);
  console.log(`ok - ${name}`);
}

try {
  await loginAsStudent(page, origin);

  const pages = { 'una-pagina': 1, libre: 3, secuencial: 1, imagenes: 1, 'no-soportadas': 1 };
  for (const [key, count] of Object.entries(pages)) {
    const { cmid, attempt } = seed.quizzes[key];
    for (let p = 0; p < count; p++) {
      const suffix = count > 1 ? `-p${p}` : '';
      await save(`attempt-${key}${suffix}`, `${origin}/mod/quiz/attempt.php?attempt=${attempt}&cmid=${cmid}${p ? `&page=${p}` : ''}`);
    }
  }
  for (const key of ['revision', 'revision-limitada']) {
    const { cmid, attempt } = seed.quizzes[key];
    await save(`review-${key}`, `${origin}/mod/quiz/review.php?attempt=${attempt}&cmid=${cmid}`);
  }
  // La revisión de un cuestionario de varias páginas, paginada y completa.
  const rev = seed.quizzes.revision;
  await save('review-revision-p1', `${origin}/mod/quiz/review.php?attempt=${rev.attempt}&cmid=${rev.cmid}&page=1`);
  await save('review-revision-showall', `${origin}/mod/quiz/review.php?attempt=${rev.attempt}&cmid=${rev.cmid}&showall=1`);
  writeFileSync(join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
} finally {
  await browser.close();
}
