// Exportar la revisión de un intento terminado (issue #11), con páginas reales
// de Moodle 5.3 del laboratorio (tools/moodle-lab: cuestionarios «Revisión
// completa» y «Revisión limitada»).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { JSDOM } from 'jsdom';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { describe, expect, it, vi } from 'vitest';
import { handleRequest, type ContentEnv } from '@/content/handler';
import { exportQuiz } from '@/export/export-quiz';
import { renderMarkdown } from '@/export/markdown';
import { collectQuiz } from '@/moodle/collect';
import { isQuizPageUrl, parseAttemptPage } from '@/moodle/parse-page';
import { readStatus } from '@/moodle/status';
import { fromBase64 } from '@/shared/base64';
import { imageResponse, LAB_URL, loadLabFixture, ORIGIN, PNG_BYTES } from '../helpers';

const parse = (name: string) => parseAttemptPage(loadLabFixture(name), LAB_URL[name]!);
const base = { generatorVersion: '0.1.0', exportedAt: '2026-10-13T12:00:00.000Z', imagePaths: new Map<string, string>() };
const golden = (file: string) => readFileSync(join(process.cwd(), 'tests', 'golden', file), 'utf8');
const docOf = (name: string) => collectQuiz(parse(name), LAB_URL[name]!, vi.fn());

describe('reconocer la revisión', () => {
  it('isQuizPageUrl acepta attempt.php y review.php, nada más', () => {
    expect(isQuizPageUrl(`${ORIGIN}/mod/quiz/attempt.php?attempt=1&cmid=2`)).toBe(true);
    expect(isQuizPageUrl(`${ORIGIN}/mod/quiz/review.php?attempt=1&cmid=2`)).toBe(true);
    expect(isQuizPageUrl(`${ORIGIN}/mod/quiz/summary.php?attempt=1`)).toBe(false);
    expect(isQuizPageUrl('no es una url')).toBe(false);
  });

  it('readStatus la clasifica como revisión con su título y total', () => {
    expect(readStatus(loadLabFixture('review-revision'), LAB_URL['review-revision']!)).toEqual({
      kind: 'review',
      title: 'Revisión completa',
      total: 6,
    });
  });

  it('un intento sigue siendo intento', () => {
    expect(readStatus(loadLabFixture('attempt-una-pagina'), LAB_URL['attempt-una-pagina']!).kind).toBe('attempt');
  });
});

describe('parseAttemptPage en la revisión', () => {
  it('lee el resumen del intento', () => {
    const page = parse('review-revision');
    expect(page.kind).toBe('review');
    expect(page.summary.map((r) => r.label)).toEqual(['Estado', 'Iniciado', 'Completado', 'Duración', 'Calificación', 'Calificación']);
    expect(page.summary[0]!.value).toBe('Terminado');
    expect(page.summary[4]!.value).toBe('25.00/60.00');
    expect(page.summary[5]!.value).toBe('41.67 de un total de 100.00');
  });

  it('resultado por pregunta, lo elegido y si cada opción elegida fue correcta', () => {
    const page = parse('review-revision');
    expect(page.questions.map((q) => [q.number, q.outcome, q.state, q.grade])).toEqual([
      [1, 'correct', 'Correcta', 'Puntúa 10.00 sobre 10.00'],
      [2, 'partial', 'Parcialmente correcta', 'Puntúa 5.00 sobre 10.00'],
      [3, 'incorrect', 'Incorrecta', 'Puntúa 0.00 sobre 10.00'],
      [4, 'incorrect', 'Incorrecta', 'Puntúa 0.00 sobre 10.00'],
      [5, 'unanswered', 'Sin contestar', 'Puntaje de 10.00'],
      [6, 'correct', 'Correcta', 'Puntúa 10.00 sobre 10.00'],
    ]);
    const chosen = page.questions.map((q) => q.choices.filter((c) => c.selected).map((c) => `${c.letter}:${c.outcome}`));
    expect(chosen).toEqual([['a:correct'], ['a:correct'], ['b:incorrect'], ['c:incorrect'], [], ['a:correct']]);
    // Las opciones no elegidas no llevan resultado.
    expect(page.questions[1]!.choices.filter((c) => !c.selected).map((c) => c.outcome)).toEqual([null, null, null]);
  });

  it('respuesta correcta y retroalimentación cuando Moodle las muestra', () => {
    const [q1, q2] = parse('review-revision').questions;
    expect(q1!.rightAnswer).toBe('La respuesta correcta es: Linux');
    expect(q1!.generalFeedback).toBe('Linux es un sistema operativo; los demás son protocolos o lenguajes.');
    expect(q1!.choices[0]!.feedback).toBe('Correcto.');
    expect(q1!.choices[0]!.text).toBe('Linux'); // la retroalimentación no se mezcla con el texto
    expect(q2!.rightAnswer).toBe('Las respuestas correctas son: TCP, UDP');
  });

  it('revisión limitada: sin respuesta correcta ni retroalimentación', () => {
    const page = parse('review-revision-limitada');
    expect(page.questions.map((q) => q.outcome)).toEqual(['incorrect', 'correct', 'unanswered']);
    for (const q of page.questions) {
      expect(q.rightAnswer).toBeNull();
      expect(q.generalFeedback).toBeNull();
      expect(q.choices.map((c) => c.feedback)).toEqual(q.choices.map(() => null));
    }
  });

  it('en un intento no hay resumen ni resultados', () => {
    const page = parse('attempt-una-pagina');
    expect(page.kind).toBe('attempt');
    expect(page.summary).toEqual([]);
    expect(page.questions.every((q) => q.outcome === null && q.rightAnswer === null)).toBe(true);
  });
});

describe('collectQuiz en la revisión', () => {
  it('si la página ya muestra todas las preguntas, no carga nada más', async () => {
    const load = vi.fn();
    const doc = await collectQuiz(parse('review-revision'), LAB_URL['review-revision']!, load);
    expect(load).not.toHaveBeenCalled();
    expect(doc.kind).toBe('review');
    expect(doc.questions).toHaveLength(6);
    expect(doc.source.path).toBe('/mod/quiz/review.php');
    expect(doc.summary).toHaveLength(6);
  });

  it('revisión paginada: carga la versión con todas las preguntas (showall=1)', async () => {
    const load = vi.fn(async (url: string) => {
      expect(new URL(url).searchParams.get('showall')).toBe('1');
      expect(new URL(url).searchParams.has('page')).toBe(false);
      return new JSDOM(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'lab', 'review-revision-showall.html'), 'utf8'), { url }).window.document;
    });
    const doc = await collectQuiz(parse('review-revision-p1'), LAB_URL['review-revision-p1']!, load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(doc.questions.map((q) => q.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(doc.warnings).toEqual([]);
  });

  it('si no puede cargarla, exporta lo que hay y avisa por cada página que falta', async () => {
    const doc = await collectQuiz(parse('review-revision-p1'), LAB_URL['review-revision-p1']!, vi.fn(async () => { throw new Error('red'); }));
    expect(doc.questions.map((q) => q.number)).toEqual([4, 5, 6]);
    expect(doc.warnings).toEqual([{ code: 'page-unavailable', detail: '0' }]);
  });
});

describe('Markdown de la revisión', () => {
  it('revisión completa (golden)', async () => {
    expect(renderMarkdown(await docOf('review-revision'), { ...base, detailed: false })).toBe(golden('lab-revision.md'));
  });

  it('revisión limitada (golden)', async () => {
    expect(renderMarkdown(await docOf('review-revision-limitada'), { ...base, detailed: false })).toBe(golden('lab-revision-limitada.md'));
  });

  it('resultado con símbolos en el título y junto a lo elegido; elegido siempre marcado', async () => {
    const md = renderMarkdown(await docOf('review-revision'), { ...base, detailed: false });
    expect(md).toContain('### 1. ¿Cuál de los siguientes es un sistema operativo? — ✅ Correcta (10.00/10.00)');
    expect(md).toContain('### 2. Elige los protocolos de la capa de transporte. — ◐ Parcialmente correcta (5.00/10.00)');
    expect(md).toContain('### 5. Selecciona los números primos. — ➖ Sin contestar (—/10.00)');
    expect(md).toContain('- [x] c. 12 ❌');
    expect(md).toContain('- **Respuesta correcta:** TCP, UDP');
    const html = new JSDOM(micromark(md, { extensions: [gfm()], htmlExtensions: [gfmHtml()], allowDangerousHtml: true })).window.document;
    expect(html.querySelectorAll('input[type="checkbox"][checked]')).toHaveLength(5);
    expect([...html.querySelectorAll('p')].filter((p) => (p.textContent ?? '').includes('\n'))).toEqual([]);
  });

  it('cuenta el resultado del intento', async () => {
    const md = renderMarkdown(await docOf('review-revision'), { ...base, detailed: false });
    expect(md).toContain('**Resultado:** ✅ 2 correctas · ◐ 1 parcialmente correcta · ❌ 2 incorrectas · ➖ 1 sin contestar');
  });
});

describe('exportar la revisión', () => {
  it('el ZIP se llama distinto que el del intento', async () => {
    const result = await exportQuiz(await docOf('review-revision'), vi.fn(), { detailed: false, generatorVersion: '0.1.0', exportedAt: base.exportedAt });
    expect(result.fileName).toBe('mqx-lab-unidad-2-revision-completa-revision.zip');
    const files = unzipSync(result.zip);
    expect(JSON.parse(strFromU8(files['mqx-lab-unidad-2-revision-completa-revision/quiz.json']!)).kind).toBe('review');
  });

  it('handleRequest exporta la revisión y rechaza el autollenado', async () => {
    const env: ContentEnv = {
      doc: loadLabFixture('review-revision'),
      url: LAB_URL['review-revision']!,
      loadPage: vi.fn(),
      fetchImage: vi.fn(async () => imageResponse(PNG_BYTES)),
    };
    const reply = await handleRequest({ type: 'mqx:export', detailed: false, generatorVersion: '0.1.0', exportedAt: base.exportedAt }, env);
    expect(reply).toMatchObject({ ok: true, questions: 6 });
    if (!('zipBase64' in reply)) throw new Error('respuesta inesperada');
    expect(Object.keys(unzipSync(fromBase64(reply.zipBase64)))).toContain('mqx-lab-unidad-2-revision-completa-revision/quiz.md');
    expect(await handleRequest({ type: 'mqx:apply', answers: '1. a' }, env)).toEqual({ ok: false, error: 'not-attempt' });
  });
});
