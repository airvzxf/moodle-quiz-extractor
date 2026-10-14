import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { QuizDocument } from '@/domain/types';
import { renderMarkdown, type MarkdownOptions } from '@/export/markdown';
import { collectQuiz } from '@/moodle/collect';
import { parseAttemptPage } from '@/moodle/parse-page';
import { FIXTURE_URL, loadFixture, REAL_FIXTURES, type FixtureName } from '../helpers';

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
    expect(md).toContain('Metadata\nTipo de respuesta: single_choice.\n\n> Generado por');
  });

  it('sin curso usa "Cuestionario Moodle" y sin preguntas lo dice', async () => {
    const doc = await docOf('edge-cases');
    const md = renderMarkdown({ ...doc, course: null, questions: [] }, { ...base, detailed: false, imagePaths: new Map() });
    expect(md).toBe(
      '# Cuestionario Moodle\n\n## Casos límite\n\nMetadata\nDesconocido: Casos_límite\n\n---\n\n_Sin preguntas._\n\n' +
        '> Generado por moodle-quiz-extractor v0.1.0 — 2026-10-13T12:00:00.000Z\n',
    );
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
    expect(md).toContain('\nNavegación: secuencial\nPáginas exportadas: 1, 3\n');
  });

  it('omite intento y módulo si no se conocen', async () => {
    const doc = await docOf('edge-cases');
    const md = renderMarkdown({ ...doc, source: { ...doc.source, attemptId: null, cmid: null } }, opts);
    expect(md).not.toContain('Intento:');
    expect(md).not.toContain('Módulo (cmid):');
  });
});
