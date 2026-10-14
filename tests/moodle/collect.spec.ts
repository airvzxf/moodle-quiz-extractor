import { describe, expect, it, vi } from 'vitest';
import { collectQuiz, pageUrl } from '@/moodle/collect';
import { parseAttemptPage } from '@/moodle/parse-page';
import { FIXTURE_URL, htmlDocument, loadFixture, type FixtureName } from '../helpers';

const start = (name: FixtureName) => parseAttemptPage(loadFixture(name), FIXTURE_URL[name]);

describe('pageUrl', () => {
  it('fija el parámetro page y quita el fragmento sin perder attempt ni cmid', () => {
    expect(pageUrl('https://m.test/mod/quiz/attempt.php?attempt=7&cmid=9#question-7-1', 2)).toBe(
      'https://m.test/mod/quiz/attempt.php?attempt=7&cmid=9&page=2',
    );
    expect(pageUrl('https://m.test/mod/quiz/attempt.php?attempt=7&page=3&cmid=9', 0)).toBe(
      'https://m.test/mod/quiz/attempt.php?attempt=7&page=0&cmid=9',
    );
  });
});

describe('collectQuiz', () => {
  it('con una sola página no pide nada más y arma el documento', async () => {
    const loadPage = vi.fn();
    const doc = await collectQuiz(start('dsop-02'), FIXTURE_URL['dsop-02'], loadPage);
    expect(loadPage).not.toHaveBeenCalled();
    expect(doc.schemaVersion).toBe(1);
    expect(doc.source).toEqual({
      origin: 'https://moodle.example.test',
      path: '/mod/quiz/attempt.php',
      attemptId: 13963,
      cmid: 11256,
    });
    expect(doc.navigation).toBe('free');
    expect(doc.pages).toEqual([0]);
    expect(doc.questions).toHaveLength(10);
    expect(doc.warnings).toEqual([]);
  });

  it('con navegación libre lee las demás páginas y une las preguntas en orden', async () => {
    const loadPage = vi.fn(async (url: string) => {
      expect(url).toBe('https://moodle.example.test/mod/quiz/attempt.php?attempt=13963&cmid=11256&page=1');
      return loadFixture('multipage-free-p1', url);
    });
    const doc = await collectQuiz(start('multipage-free-p0'), FIXTURE_URL['multipage-free-p0'], loadPage);
    expect(loadPage).toHaveBeenCalledTimes(1);
    expect(doc.pages).toEqual([0, 1]);
    expect(doc.questions.map((q) => [q.number, q.page])).toEqual([
      [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 1], [7, 1], [8, 1], [9, 1], [10, 1],
    ]);
    expect(doc.warnings).toEqual([]);
  });

  it('desde la segunda página también recupera la primera', async () => {
    const loadPage = vi.fn(async (url: string) => loadFixture('multipage-free-p0', url));
    const doc = await collectQuiz(start('multipage-free-p1'), FIXTURE_URL['multipage-free-p1'], loadPage);
    expect(loadPage).toHaveBeenCalledWith('https://moodle.example.test/mod/quiz/attempt.php?attempt=13963&cmid=11256&page=0');
    expect(doc.questions.map((q) => q.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('si una página falla exporta lo demás y avisa', async () => {
    const doc = await collectQuiz(start('multipage-free-p0'), FIXTURE_URL['multipage-free-p0'], async () => {
      throw new Error('red caída');
    });
    expect(doc.pages).toEqual([0]);
    expect(doc.questions.map((q) => q.number)).toEqual([1, 2, 3, 4, 5]);
    expect(doc.warnings).toEqual([{ code: 'page-unavailable', detail: '1' }]);
  });

  it('una página de acceso (sesión caducada) en lugar del intento cuenta como no disponible', async () => {
    const doc = await collectQuiz(start('multipage-free-p0'), FIXTURE_URL['multipage-free-p0'], async () =>
      htmlDocument('<form id="login"><input name="password"></form>'),
    );
    expect(doc.warnings).toEqual([{ code: 'page-unavailable', detail: '1' }]);
  });

  it('si Moodle devuelve otra página distinta de la pedida, no se mezcla', async () => {
    const doc = await collectQuiz(start('multipage-free-p0'), FIXTURE_URL['multipage-free-p0'], async (url) =>
      loadFixture('multipage-free-p0', url),
    );
    expect(doc.questions.map((q) => q.number)).toEqual([1, 2, 3, 4, 5]);
    expect(doc.warnings).toEqual([{ code: 'page-unavailable', detail: '1' }]);
  });

  it('con navegación secuencial no visita otras páginas y avisa', async () => {
    const loadPage = vi.fn();
    const doc = await collectQuiz(start('multipage-seq-p0'), FIXTURE_URL['multipage-seq-p0'], loadPage);
    expect(loadPage).not.toHaveBeenCalled();
    expect(doc.navigation).toBe('sequential');
    expect(doc.pages).toEqual([0]);
    expect(doc.warnings).toEqual([{ code: 'sequential-navigation', detail: '0' }]);
  });

  it('avisa de cada pregunta no soportada', async () => {
    const doc = await collectQuiz(start('edge-cases'), FIXTURE_URL['edge-cases'], vi.fn());
    expect(doc.warnings).toEqual([{ code: 'unsupported-question', detail: '2' }]);
  });

  it('es determinista: dos lecturas iguales producen documentos iguales', async () => {
    const a = await collectQuiz(start('dsop-02'), FIXTURE_URL['dsop-02'], vi.fn());
    const b = await collectQuiz(start('dsop-02'), FIXTURE_URL['dsop-02'], vi.fn());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
