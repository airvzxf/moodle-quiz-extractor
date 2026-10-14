// Prueba en Chromium con la extensión real contra el laboratorio Moodle 5.3
// (issue #12): varias páginas, imágenes con sesión, opción múltiple,
// navegación secuencial y tipos no soportados. No corre en CI: necesita
// `tools/moodle-lab/lab.sh up`.
// Uso: pnpm smoke:lab   (variables opcionales MQX_LAB_DIR, CHROMIUM_PATH)
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { chromium } from 'playwright-core';
import { loginAsStudent } from '../../tools/moodle-lab/login.mjs';

const LAB_DIR = process.env.MQX_LAB_DIR ?? join(homedir(), '.cache', 'mqx-moodle-lab');
const seed = JSON.parse(readFileSync(join(LAB_DIR, 'seed.json'), 'utf8'));
const origin = new URL(seed.wwwroot).origin;
const attemptUrl = (key, page = 0) => {
  const { attempt, cmid } = seed.quizzes[key];
  return `${origin}/mod/quiz/attempt.php?attempt=${attempt}&cmid=${cmid}${page ? `&page=${page}` : ''}`;
};

const EXTENSION_DIR = realpathSync(join(process.cwd(), '.output-smoke', 'chrome-mv3'));
const CANDIDATES = [process.env.CHROMIUM_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable'];
const executablePath = CANDIDATES.find((p) => p && existsSync(p));
if (!executablePath) throw new Error('No se encontró Chromium; define CHROMIUM_PATH.');
const extensionId = [...createHash('sha256').update(EXTENSION_DIR).digest('hex').slice(0, 32)]
  .map((c) => String.fromCharCode(97 + Number.parseInt(c, 16)))
  .join('');

function check(condition, message) {
  if (!condition) throw new Error(`FALLO: ${message}`);
  console.log(`ok - ${message}`);
}

const profile = mkdtempSync(join(tmpdir(), 'mqx-lab-chrome-'));
const downloads = mkdtempSync(join(tmpdir(), 'mqx-lab-dl-'));
const context = await chromium.launchPersistentContext(profile, {
  executablePath,
  headless: false,
  acceptDownloads: true,
  downloadsPath: downloads,
  args: ['--headless=new', `--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
});
context.setDefaultTimeout(60_000);

// Cualquier envío del intento pasa por estas páginas de Moodle.
const forbidden = [];
context.on('request', (r) => {
  if (/\/mod\/quiz\/(processattempt|summary)\.php/.test(r.url())) forbidden.push(`${r.method()} ${r.url()}`);
});

const page = await context.newPage();
const popup = await context.newPage();

async function openPopup(script = 'attempt.php') {
  await popup.goto(`chrome-extension://${extensionId}/popup.html?target=${encodeURIComponent(`http://127.0.0.1/mod/quiz/${script}*`)}`);
  // Mientras lee la pestaña, el popup muestra «Leyendo la pestaña…».
  await popup.waitForFunction(() => !/^(Leyendo|\s*$)/.test(document.getElementById('status')?.textContent ?? ''));
  return popup.textContent('#status');
}

async function exportZip() {
  // Playwright guarda las descargas con un nombre aleatorio: se usa el evento.
  const download = context.waitForEvent('download', { timeout: 30_000 }).catch(() => null);
  await popup.click('#export-btn');
  await popup.waitForFunction(() => /Listo|No se pudo/.test(document.getElementById('export-result')?.textContent ?? ''));
  const result = await popup.textContent('#export-result');
  const warnings = await popup.$$eval('#export-warnings li', (lis) => lis.map((li) => li.textContent));
  const event = await download;
  const path = event ? await event.path() : null;
  const files = path ? unzipSync(new Uint8Array(readFileSync(path))) : {};
  const entry = (suffix) => Object.entries(files).find(([n]) => n.endsWith(suffix))?.[1];
  return { result, warnings, files, md: entry('/quiz.md') && strFromU8(entry('/quiz.md')), json: entry('/quiz.json') && JSON.parse(strFromU8(entry('/quiz.json'))) };
}

try {
  await loginAsStudent(page, origin);

  // Varias páginas, navegación libre.
  await page.goto(attemptUrl('libre'), { waitUntil: 'domcontentloaded' });
  const freeStatus = await openPopup();
  check(freeStatus.includes('Página 1 de 3'), `libre: el popup reconoce 3 páginas (${freeStatus})`);
  let out = await exportZip();
  check(out.result.startsWith('Listo: 6 preguntas'), `libre: exporta las 6 preguntas de las 3 páginas (${out.result})`);
  check(JSON.stringify(out.json?.pages) === '[0,1,2]', 'libre: quiz.json incluye las páginas 0, 1 y 2');
  check((out.md.match(/^### \d+\. /gm) ?? []).length === 6, 'libre: quiz.md tiene 6 preguntas');
  const diagramUrl = out.json.questions.find((q) => q.images.length > 0)?.images[0]?.url;
  const served = Buffer.from(await (await context.request.get(diagramUrl)).body());
  const zipped = Object.entries(out.files).find(([n]) => /\/quiz\/[^/]+\.png$/.test(n))?.[1];
  check(zipped && served.subarray(0, 4).toString('hex') === '89504e47' && Buffer.from(zipped).equals(served),
    'libre: la imagen de la página 2 se descargó con la sesión (bytes idénticos a Moodle)');
  check(out.warnings.length === 0, `libre: sin avisos (${out.warnings.join(' | ')})`);

  // Autollenado: opción única y múltiple en la página actual; la 5 está en otra.
  await popup.fill('#answers', '1. a\n2. a, c\n5. a, c');
  await popup.click('#apply-btn');
  await popup.waitForFunction(() => (document.getElementById('fill-result')?.textContent ?? '') !== '');
  check((await popup.textContent('#fill-result')) === 'Aplicadas en esta página: 1, 2.', 'libre: autollenado aplica 1 y 2');
  check((await popup.textContent('#fill-messages')).includes('Pregunta 5: está en la página 3.'), 'libre: avisa que la 5 está en la página 3');
  const checked = await page.$$eval('#responseform input:checked[type="radio"], #responseform input:checked[type="checkbox"]',
    (inputs) => inputs.filter((i) => !i.name.endsWith(':flagged')).map((i) => i.closest('.que').querySelector('.qno').textContent + ':' + i.closest('[class^="r"]').querySelector('.answernumber').textContent.trim()));
  check(JSON.stringify(checked) === JSON.stringify(['1:a.', '2:a.', '2:c.']), `libre: quedaron marcadas 1a, 2a y 2c (${checked.join(', ')})`);

  // Navegación secuencial: sólo la página actual, pero sabe cuántas hay.
  await page.goto(attemptUrl('secuencial'), { waitUntil: 'domcontentloaded' });
  const seqStatus = await openPopup();
  check(seqStatus.includes('Página 1 de 2') && seqStatus.includes('secuencial'), `secuencial: el popup lo indica (${seqStatus})`);
  out = await exportZip();
  check(out.result.startsWith('Listo: 2 preguntas'), `secuencial: exporta sólo la página actual (${out.result})`);

  // Imágenes en enunciado y opciones.
  await page.goto(attemptUrl('imagenes'), { waitUntil: 'domcontentloaded' });
  await openPopup();
  out = await exportZip();
  const pngs = Object.keys(out.files).filter((n) => n.endsWith('.png'));
  check(pngs.length === 3, `imágenes: el ZIP trae las 3 imágenes (${pngs.join(', ')})`);
  check(out.warnings.length === 0, `imágenes: sin avisos (${out.warnings.join(' | ')})`);

  // Tipos no soportados: se exportan con aviso, uno por pregunta.
  await page.goto(attemptUrl('no-soportadas'), { waitUntil: 'domcontentloaded' });
  await openPopup();
  out = await exportZip();
  check(out.result.startsWith('Listo: 7 preguntas'), `no soportadas: exporta las 7 (${out.result})`);
  check(out.warnings.length === 6, `no soportadas: 6 avisos (${out.warnings.length})`);

  // Revisión de un intento terminado: sólo exportar, sin autollenado.
  const rev = seed.quizzes.revision;
  await page.goto(`${origin}/mod/quiz/review.php?attempt=${rev.attempt}&cmid=${rev.cmid}`, { waitUntil: 'domcontentloaded' });
  const revStatus = await openPopup('review.php');
  check(revStatus === 'Revisión: Revisión completa · 6 preguntas', `revisión: el popup la reconoce (${revStatus})`);
  check(await popup.isHidden('#fill'), 'revisión: no ofrece autollenado');
  out = await exportZip();
  check(out.result.startsWith('Listo: 6 preguntas en mqx-lab-unidad-2-revision-completa-revision.zip'), `revisión: exporta las 6 (${out.result})`);
  check(out.json?.kind === 'review' && out.json.summary.length === 6, 'revisión: quiz.json trae el tipo y el resumen');
  check(out.md.includes('**Resultado:** ✅ 2 correctas · ◐ 1 parcialmente correcta · ❌ 2 incorrectas · ➖ 1 sin contestar'),
    'revisión: quiz.md trae el recuento del resultado');

  check(forbidden.length === 0, `nunca se envió el intento (${forbidden.join(', ')})`);
  console.log('SMOKE LAB CHROME OK');
} finally {
  await context.close();
  for (const dir of [profile, downloads]) {
    if (dir.startsWith(tmpdir())) rmSync(dir, { recursive: true, force: true });
  }
}
