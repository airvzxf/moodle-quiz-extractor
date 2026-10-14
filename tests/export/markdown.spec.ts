import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { QuizDocument } from '@/domain/types';
import { renderMarkdown, type MarkdownOptions } from '@/export/markdown';
import { collectQuiz } from '@/moodle/collect';
import { parseAttemptPage } from '@/moodle/parse-page';
import { JSDOM } from 'jsdom';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { FIXTURE_URL, LAB_URL, loadFixture, loadLabFixture, REAL_FIXTURES, type FixtureName } from '../helpers';

const base = { generatorVersion: '0.1.0', exportedAt: '2026-10-13T12:00:00.000Z' };
const golden = (file: string) => readFileSync(join(process.cwd(), 'tests', 'golden', file), 'utf8');
const docOf = (n: FixtureName): Promise<QuizDocument> =>
  collectQuiz(parseAttemptPage(loadFixture(n), FIXTURE_URL[n]), FIXTURE_URL[n], vi.fn());
const EDGE_PATHS = new Map([
  ['https://moodle.example.test/pluginfile.php/1/question/questiontext/500/4/9/diagrama%20red.png', 'quiz/diagrama_red.png'],
]);

describe('renderMarkdown, formato por defecto', () => {
  it.each(REAL_FIXTURES)('%s coincide byte a byte con el contrato', async (name) => {
    const doc = await docOf(name);
    const imagePaths = new Map(doc.questions.flatMap((q) => q.images).map((i) => [i.url, `quiz/${i.url.split('/').pop()}`]));
    expect(renderMarkdown(doc, { ...base, detailed: false, imagePaths })).toBe(golden(`${name}.md`));
  });

  it('casos límite: sin unidad, no soportadas, imágenes no descargadas enlazan la URL original', async () => {
    const md = renderMarkdown(await docOf('edge-cases'), { ...base, detailed: false, imagePaths: EDGE_PATHS });
    expect(md).toBe(golden('edge-cases.md'));
  });

  it('nunca marca [x] aunque haya opciones seleccionadas', async () => {
    const md = renderMarkdown(await docOf('edge-cases'), { ...base, detailed: false, imagePaths: new Map() });
    expect(md).not.toContain('[x]');
  });

  it('las opciones son una lista de tareas de Markdown (- [ ] / - [x])', async () => {
    const doc = await docOf('edge-cases');
    const plain = renderMarkdown(doc, { ...base, detailed: false, imagePaths: new Map() });
    const detailed = renderMarkdown(doc, { ...base, detailed: true, imagePaths: new Map() });
    expect(plain).toMatch(/^- \[ \] a\. /m);
    expect(detailed).toMatch(/^- \[x\] [a-z]\. /m);
    expect(`${plain}\n${detailed}`).not.toMatch(/^\[( |x)\] /m);
  });

  it('no inventa puntaje ni estado cuando la página no los trae', async () => {
    const doc = await docOf('edge-cases');
    doc.questions = [{ ...doc.questions[0]!, grade: null, state: null }];
    const md = renderMarkdown(doc, { ...base, detailed: false, imagePaths: new Map() });
    expect(md).toContain('<details><summary>Datos</summary>\n\n- **Tipo:** opción única\n\n</details>');
  });

  it('sin curso ni unidad sólo pone el título, y sin preguntas lo dice', async () => {
    const doc = await docOf('edge-cases');
    const md = renderMarkdown(
      { ...doc, course: null, unit: null, section: null, questions: [] },
      { ...base, detailed: false, imagePaths: new Map() },
    );
    expect(md).toBe('# Casos límite\n\n---\n\n_Sin preguntas._\n\n> Generado por moodle-quiz-extractor v0.1.0 — 2026-10-13T12:00:00.000Z\n');
  });

  it('sin título usa "Cuestionario Moodle"', async () => {
    const doc = await docOf('edge-cases');
    const md = renderMarkdown({ ...doc, title: '' }, { ...base, detailed: false, imagePaths: new Map() });
    expect(md.startsWith('# Cuestionario Moodle\n')).toBe(true);
  });
});

describe('renderMarkdown se ve bien al renderizar (CommonMark + GFM)', () => {
  const html = (md: string) => new JSDOM(micromark(md, { extensions: [gfm()], htmlExtensions: [gfmHtml()], allowDangerousHtml: true })).window.document;
  const modes = [false, true].map((detailed) => ({ ...base, detailed, imagePaths: EDGE_PATHS }));

  it.each(modes)('ningún párrafo junta varias líneas (detallado: $detailed)', async (opts) => {
    for (const name of [...REAL_FIXTURES, 'edge-cases'] as const) {
      const doc = html(renderMarkdown(await docOf(name), opts));
      const merged = [...doc.querySelectorAll('p')].map((p) => p.textContent ?? '').filter((t) => t.includes('\n'));
      expect(merged, name).toEqual([]);
    }
  });

  it.each(modes)('opciones como casillas e imágenes visibles (detallado: $detailed)', async (opts) => {
    const doc = html(renderMarkdown(await docOf('edge-cases'), opts));
    const boxes = [...doc.querySelectorAll('li > input[type="checkbox"]')] as HTMLInputElement[];
    expect(boxes).toHaveLength(7);
    expect(boxes.filter((b) => b.checked)).toHaveLength(opts.detailed ? 3 : 0);
    const images = [...doc.querySelectorAll('img')].map((i) => [i.getAttribute('alt'), i.getAttribute('src')]);
    expect(images).toEqual([
      ['Diagrama de red', './quiz/diagrama_red.png'],
      ['Logo externo', 'https://cdn.example.org/logo.png'],
      ['Opción con imagen', 'https://moodle.example.test/pluginfile.php/1/question/answer/500/4/11/opcion.png'],
      ['Otro diagrama', 'https://moodle.example.test/pluginfile.php/1/question/questiontext/500/5/9/diagrama%20red.png'],
    ]);
  });

  it('los datos de cada pregunta van plegados en <details> como lista', async () => {
    const doc = html(renderMarkdown(await docOf('edge-cases'), { ...base, detailed: false, imagePaths: EDGE_PATHS }));
    const details = [...doc.querySelectorAll('details')];
    expect(details).toHaveLength(4);
    expect(details.map((d) => d.querySelector('summary')?.textContent)).toEqual(['Datos', 'Datos', 'Datos', 'Datos']);
    expect([...details[0]!.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Tipo: opción única',
      'Puntaje de 5.00',
      'Respuesta guardada',
    ]);
  });

  it('el texto del examen no se interpreta como Markdown ni HTML', async () => {
    const doc = await docOf('edge-cases');
    // Una URL suelta sí puede volverse enlace (autoenlace GFM); [texto](destino) no.
    const tricky = 'Calcula 2*3*4, usa _x_ y <b>no</b> [enlace](pagina.html) `code` ~~no~~';
    doc.questions = [{ ...doc.questions[0]!, text: tricky, choices: [{ ...doc.questions[0]!.choices[0]!, text: tricky }] }];
    const out = html(renderMarkdown(doc, { ...base, detailed: false, imagePaths: new Map() }));
    expect(out.querySelector('h3')?.textContent).toBe(`1. ${tricky}`);
    expect(out.querySelector('li')?.textContent?.trim()).toBe(`a. ${tricky}`);
    const fromMoodle = [out.querySelector('h3')!, out.querySelector('li')!];
    expect(fromMoodle.flatMap((el) => [...el.querySelectorAll('b, a, code, del, em, strong')])).toHaveLength(0);
  });
});

describe('renderMarkdown con páginas del laboratorio Moodle 5.3', () => {
  it('imágenes en enunciado y opciones (golden)', async () => {
    const url = LAB_URL['attempt-imagenes']!;
    const doc = await collectQuiz(parseAttemptPage(loadLabFixture('attempt-imagenes'), url), url, vi.fn());
    const paths = new Map(
      [...doc.questions.flatMap((q) => q.images), ...doc.questions.flatMap((q) => q.choices.flatMap((c) => c.images))].map(
        (i) => [i.url, `quiz/${decodeURIComponent(i.url.split('/').pop()!).replaceAll(' ', '_')}`],
      ),
    );
    expect(renderMarkdown(doc, { ...base, detailed: false, imagePaths: paths })).toBe(golden('lab-imagenes.md'));
  });
});

describe('renderMarkdown, modo detallado', () => {
  const opts: MarkdownOptions = { ...base, detailed: true, imagePaths: EDGE_PATHS };

  it('añade metadatos técnicos, avisos y marca lo seleccionado', async () => {
    expect(renderMarkdown(await docOf('edge-cases'), opts)).toBe(golden('edge-cases.detailed.md'));
  });

  it('muestra las páginas exportadas contando desde 1 y la navegación secuencial', async () => {
    const doc = await docOf('edge-cases');
    const md = renderMarkdown({ ...doc, pages: [0, 2], navigation: 'sequential' }, opts);
    expect(md).toContain('\n- **Navegación:** secuencial\n- **Páginas exportadas:** 1, 3\n');
  });

  it('omite intento y módulo si no se conocen', async () => {
    const doc = await docOf('edge-cases');
    const md = renderMarkdown({ ...doc, source: { ...doc.source, attemptId: null, cmid: null } }, opts);
    expect(md).not.toContain('**Intento:**');
    expect(md).not.toContain('**Módulo (cmid):**');
  });
});
