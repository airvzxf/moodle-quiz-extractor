import { describe, expect, it } from 'vitest';
import { readStatus } from '@/moodle/status';
import { FIXTURE_URL, htmlDocument, loadFixture, ORIGIN } from '../helpers';

describe('readStatus', () => {
  it('un intento de una página informa título, preguntas y total', () => {
    expect(readStatus(loadFixture('dsop-02'), FIXTURE_URL['dsop-02'])).toEqual({
      kind: 'attempt',
      title: 'Actividad 1. Cuestionario',
      currentPage: 0,
      pages: [0],
      mode: 'free',
      onPage: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      total: 10,
    });
  });

  it('en multipágina distingue lo que hay en esta página del total', () => {
    const status = readStatus(loadFixture('multipage-free-p1'), FIXTURE_URL['multipage-free-p1']);
    expect(status).toMatchObject({ kind: 'attempt', currentPage: 1, pages: [0, 1], onPage: [6, 7, 8, 9, 10], total: 10 });
  });

  it('detecta el formulario de acceso de una sesión caducada', () => {
    const doc = htmlDocument('<form id="login"><input name="username"><input name="password" type="password"></form>');
    expect(readStatus(doc, `${ORIGIN}/login/index.php`)).toEqual({ kind: 'login' });
  });

  it('otra página de Moodle no es un intento', () => {
    expect(readStatus(loadFixture('dsop-02'), `${ORIGIN}/mod/quiz/summary.php?attempt=1`)).toEqual({ kind: 'not-attempt' });
    expect(readStatus(htmlDocument('<p>hola</p>'), FIXTURE_URL['dsop-02'])).toEqual({ kind: 'not-attempt' });
  });
});
