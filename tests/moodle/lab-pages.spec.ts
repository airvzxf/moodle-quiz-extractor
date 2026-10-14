// Páginas reales de Moodle 5.3 (laboratorio, issue #12): el parser debe
// leerlas igual que las sintéticas. Contenido en tools/moodle-lab/questions.xml.
import { describe, expect, it } from 'vitest';
import { parseAttemptPage, readNavigation } from '@/moodle/parse-page';
import { LAB_URL, loadLabFixture } from '../helpers';

const parse = (name: string) => parseAttemptPage(loadLabFixture(name), LAB_URL[name]!);
const summary = (name: string) =>
  parse(name).questions.map((q) => ({
    n: q.number,
    kind: q.kind,
    type: q.moodleType,
    choices: q.choices.map((c) => `${c.letter}${c.selected ? '*' : ''} ${c.text}`),
  }));

describe('laboratorio Moodle 5.3: páginas de intento', () => {
  it('una página: opción única, verdadero/falso y una respuesta guardada', () => {
    expect(summary('attempt-una-pagina')).toEqual([
      { n: 1, kind: 'single_choice', type: 'multichoice', choices: ['a* Linux', 'b HTTP', 'c HTML', 'd TCP'] },
      { n: 2, kind: 'single_choice', type: 'truefalse', choices: ['a Verdadero', 'b Falso'] },
      { n: 3, kind: 'single_choice', type: 'multichoice', choices: ['a Volátil', 'b Permanente', 'c Óptica'] },
      { n: 4, kind: 'single_choice', type: 'multichoice', choices: ['a 8', 'b 10', 'c 12'] },
    ]);
    const page = parse('attempt-una-pagina');
    expect(page.questions[0]!.state).toBe('Respuesta guardada');
    expect(page.questions[1]!.state).toBe('Sin responder aún');
    expect(page.questions[0]!.grade).toBe('Puntaje de 10.00');
    expect(page.questions[0]!.instruction).toBe('Seleccione una:');
    expect(page.unit).toBe('Unidad 1');
    expect(page.title).toBe('Una página');
  });

  it('varias páginas con navegación libre: cada página trae sus preguntas', () => {
    expect(parse('attempt-libre-p0').questions.map((q) => q.number)).toEqual([1, 2]);
    expect(parse('attempt-libre-p1').questions.map((q) => q.number)).toEqual([3, 4]);
    expect(parse('attempt-libre-p2').questions.map((q) => q.number)).toEqual([5, 6]);
    expect(summary('attempt-libre-p0')[1]).toEqual({
      n: 2, kind: 'multiple_choice', type: 'multichoice', choices: ['a TCP', 'b HTTP', 'c UDP', 'd FTP'],
    });
    expect(parse('attempt-libre-p0').questions[1]!.instruction).toBe('Seleccione una o más de una:');
  });

  it('navegación libre: todas las páginas y la página actual', () => {
    const nav = readNavigation(loadLabFixture('attempt-libre-p1'));
    expect(nav.mode).toBe('free');
    expect(nav.pages).toEqual([0, 1, 2]);
    expect(nav.currentPage).toBe(1);
    expect(nav.entries).toEqual([
      { number: 1, page: 0 }, { number: 2, page: 0 }, { number: 3, page: 1 },
      { number: 4, page: 1 }, { number: 5, page: 2 }, { number: 6, page: 2 },
    ]);
  });

  it('navegación secuencial: Moodle usa <span class="qnbutton sequential">, no enlaces', () => {
    const nav = readNavigation(loadLabFixture('attempt-secuencial'));
    expect(nav.mode).toBe('sequential');
    expect(nav.pages).toEqual([0, 1]);
    expect(nav.currentPage).toBe(0);
    expect(nav.entries).toEqual([
      { number: 1, page: 0 }, { number: 2, page: 0 }, { number: 3, page: 1 }, { number: 4, page: 1 },
    ]);
  });

  it('imágenes de pluginfile.php en el enunciado y en las opciones, sin query', () => {
    const [diagram, colors] = parse('attempt-imagenes').questions;
    expect(diagram!.images).toHaveLength(1);
    expect(diagram!.images[0]!.alt).toBe('Diagrama de red');
    expect(diagram!.images[0]!.url).toMatch(/^https:\/\/moodle\.example\.test\/pluginfile\.php\/.+\/diagrama%20red\.png$/);
    expect(colors!.choices.map((c) => [c.letter, c.text, c.images.map((i) => i.alt)])).toEqual([
      ['a', '', ['Opción roja']],
      ['b', '', ['Opción verde']],
      ['c', 'Ninguna de las anteriores', []],
    ]);
    expect(colors!.choices[1]!.images[0]!.url).toMatch(/\/question\/answer\/.+\/verde\.png$/);
  });

  it('tipos no soportados: se reconocen como unsupported con su tipo Moodle', () => {
    expect(parse('attempt-no-soportadas').questions.map((q) => [q.kind, q.moodleType])).toEqual([
      ['single_choice', 'multichoice'],
      ['unsupported', 'match'],
      ['unsupported', 'shortanswer'],
      ['unsupported', 'numerical'],
      ['unsupported', 'essay'],
      ['unsupported', 'gapselect'],
      ['unsupported', 'multianswer'],
    ]);
  });
});
