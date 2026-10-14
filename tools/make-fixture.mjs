#!/usr/bin/env node
// Convierte una página de intento de Moodle guardada desde el navegador en una
// fixture mínima y segura para tests:
//   - conserva sólo lo que lee la extensión: <title>, migas de pan, encabezado,
//     #responseform y el bloque de navegación del cuestionario;
//   - elimina <script>, <noscript> y <style>;
//   - reemplaza la sesskey y el dominio real.
// Uso: node tools/make-fixture.mjs <entrada.html> <salida.html>
import { readFileSync, writeFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Uso: node tools/make-fixture.mjs <entrada.html> <salida.html>');
  process.exit(2);
}

const raw = readFileSync(input, 'utf8');
const { document } = new JSDOM(raw, { virtualConsole: new VirtualConsole() }).window;

const sesskey = document.querySelector('input[name="sesskey"]')?.getAttribute('value') ?? null;
const parts = [
  document.querySelector('ol.breadcrumb')?.closest('nav'),
  document.querySelector('.page-header-headings'),
  document.querySelector('form#responseform'),
  document.querySelector('#mod_quiz_navblock'),
].filter((el) => el != null);

for (const el of parts) {
  el.querySelectorAll('script, noscript, style').forEach((s) => s.remove());
}

const title = document.title.trim();
let html = [
  '<!DOCTYPE html>',
  '<html lang="es-mx"><head><meta charset="utf-8">',
  `<title>${title}</title></head>`,
  '<body id="page-mod-quiz-attempt" class="path-mod-quiz">',
  ...parts.map((el) => el.outerHTML),
  '</body></html>',
  '',
].join('\n');

if (sesskey) html = html.split(sesskey).join('SESSKEY_REDACTED');
html = html.replace(/[a-z0-9.-]*unadmexico\.mx/g, 'moodle.example.test');

writeFileSync(output, html);
console.log(`${output}: ${html.length} bytes`);
