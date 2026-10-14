// Prueba de humo en Firefox con la extensión real compilada (WXT_SMOKE=1),
// manejada por WebDriver BiDi (sin dependencias extra). Usa un perfil temporal
// con -remote-allow-system-access para poder leer el popup (página moz-extension).
// Uso: pnpm smoke:firefox   (variable opcional FIREFOX_PATH)
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { PNG, SESSION_COOKIE, startFakeMoodle } from './fake-moodle.mjs';

const EXTENSION_DIR = realpathSync(join(process.cwd(), '.output-smoke', 'firefox-mv3'));
const EXTENSION_ID = 'moodle-quiz-extractor@airvzxf.dev';
const EXTENSION_UUID = '6f1f3c3e-8a51-4d7e-9a7c-5b0d8c3f2a11';
const CANDIDATES = [process.env.FIREFOX_PATH, '/usr/bin/firefox', '/usr/lib/firefox/firefox'];
const executable = CANDIDATES.find((p) => p && existsSync(p));
if (!executable) throw new Error('No se encontró Firefox; define FIREFOX_PATH.');

function check(condition, message) {
  if (!condition) throw new Error(`FALLO: ${message}`);
  console.log(`ok - ${message}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const moodle = await startFakeMoodle();
const profile = mkdtempSync(join(tmpdir(), 'mqx-smoke-firefox-'));
const downloads = mkdtempSync(join(tmpdir(), 'mqx-smoke-dl-'));
writeFileSync(
  join(profile, 'user.js'),
  [
    `user_pref("extensions.webextensions.uuids", ${JSON.stringify(JSON.stringify({ [EXTENSION_ID]: EXTENSION_UUID }))});`,
    `user_pref("browser.download.dir", ${JSON.stringify(downloads)});`,
    'user_pref("browser.download.folderList", 2);',
    'user_pref("browser.download.useDownloadDir", true);',
    'user_pref("browser.download.always_ask_before_handling_new_types", false);',
    'user_pref("browser.shell.checkDefaultBrowser", false);',
    'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
    '',
  ].join('\n'),
);

const port = 9300 + Math.floor(Math.random() * 500);
const firefox = spawn(executable, ['--headless', '--no-remote', '-remote-allow-system-access', '--profile', profile, `--remote-debugging-port=${port}`], {
  stdio: ['ignore', 'ignore', 'pipe'],
});
// En un runner frío Firefox puede tardar más de 20 s en abrir BiDi; se
// espera hasta 60 s y, si falla, se muestra el final de su stderr.
let stderr = '';
let exited = false;
firefox.stderr.on('data', (chunk) => {
  stderr = (stderr + chunk).slice(-4000);
});
firefox.on('exit', () => {
  exited = true;
});

let ws;
const deadline = Date.now() + 60_000;
while (!ws && !exited && Date.now() < deadline) {
  await sleep(250);
  try {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/session`);
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = reject;
    });
    ws = socket;
  } catch {
    ws = undefined;
  }
}
if (!ws) {
  firefox.kill();
  throw new Error(`No se pudo conectar con Firefox por WebDriver BiDi${exited ? ' (Firefox terminó)' : ''}.\n${stderr}`);
}

let nextId = 1;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.type === 'error') reject(new Error(`${msg.error}: ${msg.message}`));
    else resolve(msg.result);
  }
};
const bidi = (method, params) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (context, expression) => {
  const r = await bidi('script.evaluate', { expression, target: { context }, awaitPromise: true });
  if (r.type === 'exception') throw new Error(r.exceptionDetails.text);
  return r.result.value;
};
const waitFor = async (context, expression, timeout = 20_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await evaluate(context, expression)) return;
    await sleep(200);
  }
  throw new Error(`Tiempo agotado esperando: ${expression}`);
};

try {
  await bidi('session.new', { capabilities: {} });
  await bidi('webExtension.install', { extensionData: { type: 'path', path: EXTENSION_DIR } });
  await bidi('storage.setCookie', {
    cookie: { name: SESSION_COOKIE.name, value: { type: 'string', value: SESSION_COOKIE.value }, domain: '127.0.0.1', path: '/' },
  });

  const { context: page } = await bidi('browsingContext.create', { type: 'tab' });
  await bidi('browsingContext.navigate', { context: page, url: moodle.attemptUrl, wait: 'complete' });
  const target = encodeURIComponent('http://127.0.0.1/mod/quiz/attempt.php*');
  const popupUrl = `moz-extension://${EXTENSION_UUID}/popup.html?target=${target}`;
  await bidi('script.evaluate', {
    expression: `window.open(${JSON.stringify(popupUrl)}, '_blank'); true`,
    target: { context: page },
    awaitPromise: false,
    userActivation: true,
  });
  let popup;
  for (let i = 0; i < 50 && !popup; i++) {
    await sleep(200);
    const { contexts } = await bidi('browsingContext.getTree', {});
    popup = contexts.find((c) => c.url.startsWith(`moz-extension://${EXTENSION_UUID}/popup.html`))?.context;
  }
  if (!popup) throw new Error('No se abrió el popup.');

  await waitFor(popup, `document.getElementById('status').textContent.includes('Página 1 de 2')`);
  check(true, 'el popup reconoce el intento y sus 2 páginas');

  await evaluate(popup, `document.getElementById('export-btn').click()`);
  await waitFor(popup, `/Listo|No se pudo/.test(document.getElementById('export-result').textContent)`, 30_000);
  const result = await evaluate(popup, `document.getElementById('export-result').textContent`);
  check(result.startsWith('Listo: 10 preguntas'), `exporta las 10 preguntas de las 2 páginas (${result})`);

  let zipName;
  for (let i = 0; i < 50 && !zipName; i++) {
    zipName = readdirSync(downloads).find((f) => f.endsWith('.zip'));
    if (!zipName) await sleep(200);
  }
  check(zipName !== undefined, 'el ZIP se descargó');
  const files = unzipSync(new Uint8Array(readFileSync(join(downloads, zipName))));
  const names = Object.keys(files);
  const md = strFromU8(files[names.find((n) => n.endsWith('/quiz.md'))]);
  const json = JSON.parse(strFromU8(files[names.find((n) => n.endsWith('/quiz.json'))]));
  const png = files[names.find((n) => n.endsWith('/quiz/A2_Examen_U1.png'))];
  check((md.match(/^### \d+\. /gm) ?? []).length === 10, 'quiz.md tiene 10 preguntas');
  check(JSON.stringify(json.pages) === '[0,1]', 'quiz.json incluye las páginas 0 y 1');
  check(png !== undefined && Buffer.from(png).equals(PNG), 'la imagen se descargó con la sesión de la página (content.fetch)');

  await evaluate(
    popup,
    `(() => { const t = document.getElementById('answers'); t.value = '1. a, c\\n2. c\\n7. b'; t.dispatchEvent(new Event('input')); document.getElementById('apply-btn').click(); })()`,
  );
  await waitFor(popup, `document.getElementById('fill-result').textContent !== ''`);
  const fill = await evaluate(popup, `document.getElementById('fill-result').textContent`);
  check(fill === 'Aplicadas en esta página: 1, 2.', `autollenado aplica las de esta página (${fill})`);
  const messages = await evaluate(popup, `document.getElementById('fill-messages').textContent`);
  check(messages.includes('Pregunta 7: está en la página 2.'), 'avisa que la 7 está en la página 2');
  const state = await evaluate(
    page,
    `['q13963:10_choice0', 'q13963:10_choice2', 'q13963:2_answer2'].every((id) => document.getElementById(id).checked)`,
  );
  check(state, 'los controles quedaron marcados en la página');

  await bidi('storage.deleteCookies', {});
  await evaluate(popup, `document.getElementById('export-btn').click()`);
  await waitFor(popup, `/Listo: 5|No se pudo/.test(document.getElementById('export-result').textContent)`, 30_000);
  const warnings = await evaluate(popup, `document.getElementById('export-warnings').textContent`);
  check(warnings.includes('No se pudo leer la página 2.'), 'sin sesión, la página 2 cuenta como no disponible');

  check(moodle.log.posts.length === 0, 'la extensión nunca hizo POST (nunca envió el intento)');
  console.log('SMOKE FIREFOX OK');
} finally {
  try {
    await bidi('session.end', {});
  } catch {
    // Firefox puede cerrar la conexión antes de responder.
  }
  ws.close();
  firefox.kill();
  await moodle.close();
  await sleep(500);
  for (const dir of [profile, downloads]) {
    if (dir.startsWith(tmpdir())) rmSync(dir, { recursive: true, force: true });
  }
}
