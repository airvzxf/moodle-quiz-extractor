// Utilidades compartidas por los tests. No contiene lógica del producto.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

export const ORIGIN = 'https://moodle.example.test';

/** URL con la que cada fixture se "abrió" en el navegador. */
export const FIXTURE_URL = {
  'ddoo-01': `${ORIGIN}/mod/quiz/attempt.php?attempt=13843&cmid=11291`,
  'ddoo-02': `${ORIGIN}/mod/quiz/attempt.php?attempt=14070&cmid=11292`,
  'dsop-01': `${ORIGIN}/mod/quiz/attempt.php?attempt=13833&cmid=11255`,
  'dsop-02': `${ORIGIN}/mod/quiz/attempt.php?attempt=13963&cmid=11256`,
  'multipage-free-p0': `${ORIGIN}/mod/quiz/attempt.php?attempt=13963&cmid=11256`,
  'multipage-free-p1': `${ORIGIN}/mod/quiz/attempt.php?attempt=13963&cmid=11256&page=1`,
  'multipage-seq-p0': `${ORIGIN}/mod/quiz/attempt.php?attempt=13963&cmid=11256`,
  'edge-cases': `${ORIGIN}/mod/quiz/attempt.php?attempt=500&cmid=600`,
} as const;

export type FixtureName = keyof typeof FIXTURE_URL;

export const REAL_FIXTURES = ['ddoo-01', 'ddoo-02', 'dsop-01', 'dsop-02'] as const;

export function fixtureHtml(name: FixtureName): string {
  // En el entorno jsdom import.meta.url no es file://: se resuelve desde la raíz.
  return readFileSync(join(process.cwd(), 'tests', 'fixtures', `${name}.html`), 'utf8');
}

/** Documento de la fixture con su URL (los relativos se resuelven contra ella). */
export function loadFixture(name: FixtureName, url: string = FIXTURE_URL[name]): Document {
  return new JSDOM(fixtureHtml(name), { url }).window.document;
}

export function htmlDocument(html: string, url = `${ORIGIN}/mod/quiz/attempt.php?attempt=1&cmid=2`): Document {
  return new JSDOM(html, { url }).window.document;
}

/** Respuesta HTTP falsa para inyectar en fetchImage. */
export function imageResponse(bytes: Uint8Array<ArrayBuffer>, type = 'image/png', status = 200): Response {
  return new Response(bytes, { status, headers: { 'content-type': type } });
}

export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
