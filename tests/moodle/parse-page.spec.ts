import { describe, expect, it } from 'vitest';
import { isAttemptUrl, parseAttemptPage, readNavigation } from '@/moodle/parse-page';
import { FIXTURE_URL, loadFixture, ORIGIN, REAL_FIXTURES } from '../helpers';

const parse = (name: keyof typeof FIXTURE_URL) => parseAttemptPage(loadFixture(name), FIXTURE_URL[name]);

describe('isAttemptUrl', () => {
  it('reconoce la página de intento con o sin parámetros', () => {
    expect(isAttemptUrl(`${ORIGIN}/mod/quiz/attempt.php?attempt=1&cmid=2&page=3`)).toBe(true);
    expect(isAttemptUrl(`${ORIGIN}/moodle/mod/quiz/attempt.php`)).toBe(true);
  });

  it('rechaza otras páginas de Moodle y URLs inválidas', () => {
    expect(isAttemptUrl(`${ORIGIN}/mod/quiz/summary.php?attempt=1`)).toBe(false);
    expect(isAttemptUrl(`${ORIGIN}/mod/quiz/view.php?id=1`)).toBe(false);
    expect(isAttemptUrl('no es una url')).toBe(false);
  });
});

describe('parseAttemptPage con los cuestionarios reales', () => {
  it.each(REAL_FIXTURES)('%s tiene 10 preguntas numeradas del 1 al 10 en orden', (name) => {
    expect(parse(name).questions.map((q) => q.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('lee curso, unidad, título y sección del encabezado', () => {
    const page = parse('dsop-02');
    expect(page.course).toBe('02 – Sistemas operativos – DSOP');
    expect(page.unit).toBe('Unidad 1');
    expect(page.title).toBe('Actividad 1. Cuestionario');
    expect(page.section).toBe('Actividad 1. Cuestionario');
  });

  it('deja la sección en null cuando la página no la tiene', () => {
    expect(parse('ddoo-02').section).toBeNull();
  });

  it('lee el intento y el módulo de la URL', () => {
    const page = parse('dsop-02');
    expect(page.attemptId).toBe(13963);
    expect(page.cmid).toBe(11256);
  });

  it('usa el formulario cuando la URL no trae attempt ni cmid', () => {
    const page = parseAttemptPage(loadFixture('dsop-02'), `${ORIGIN}/mod/quiz/attempt.php`);
    expect(page.attemptId).toBe(13963);
    expect(page.cmid).toBe(11256);
  });

  it('clasifica las preguntas por sus controles: radio es una opción, checkbox varias', () => {
    const kinds = parse('dsop-02').questions.map((q) => q.kind);
    expect(kinds[0]).toBe('multiple_choice');
    expect(kinds.slice(1).every((k) => k === 'single_choice')).toBe(true);
  });

  it('las casillas de "señalar con bandera" no convierten una pregunta en de varias respuestas', () => {
    expect(parse('ddoo-01').questions.every((q) => q.kind === 'single_choice')).toBe(true);
  });

  it('extrae letra, texto e id de cada opción sin el control "Borrar mi elección"', () => {
    const q2 = parse('dsop-02').questions[1]!;
    expect(q2.choices.map((c) => [c.letter, c.text, c.inputId])).toEqual([
      ['a', '1A, 2C, 3D, 4B', 'q13963:2_answer0'],
      ['b', '1C, 2A, 3D, 4B', 'q13963:2_answer1'],
      ['c', '1D, 2B, 3A, 4C', 'q13963:2_answer2'],
      ['d', '1B, 2A, 3C, 4D', 'q13963:2_answer3'],
    ]);
    expect(q2.choices.every((c) => !c.selected)).toBe(true);
  });

  it('lee enunciado, imagen sin query, instrucción, puntaje, estado, slot y tipo Moodle', () => {
    const q2 = parse('dsop-02').questions[1]!;
    expect(q2.text).toBe('Relaciona las siguientes columnas:');
    expect(q2.images).toEqual([
      {
        url: `${ORIGIN}/pluginfile.php/11978/question/questiontext/13963/2/5896/A2_Examen_U1.png`,
        alt: 'Unir elementos segun corresponda la descripción',
      },
    ]);
    expect(q2.instruction).toBe('Seleccione una:');
    expect(q2.grade).toBe('Puntaje de 10.00');
    expect(q2.state).toBe('Sin responder aún');
    expect(q2.slot).toBe(2);
    expect(q2.moodleType).toBe('multichoice');
    expect(q2.page).toBe(0);
  });
});

describe('parseAttemptPage con casos límite', () => {

  it('omite los bloques de información sin número', () => {
    const page = parse('edge-cases');
    expect(page.questions.map((q) => q.number)).toEqual([1, 2, 3, 4]);
  });

  it('con sólo dos migas de pan hay curso pero no unidad', () => {
    const page = parse('edge-cases');
    expect(page.course).toBe('Curso de prueba');
    expect(page.unit).toBeNull();
  });

  it('verdadero/falso sin letras recibe a y b por orden y conserva lo marcado', () => {
    const page = parse('edge-cases');
    const tf = page.questions[0]!;
    expect(tf.kind).toBe('single_choice');
    expect(tf.moodleType).toBe('truefalse');
    expect(tf.choices.map((c) => [c.letter, c.text, c.selected])).toEqual([
      ['a', 'Verdadero', true],
      ['b', 'Falso', false],
    ]);
    expect(tf.instruction).toBe('Seleccione uno:');
  });

  it('una pregunta de texto corto es unsupported y no tiene opciones', () => {
    const page = parse('edge-cases');
    const sa = page.questions[1]!;
    expect(sa.kind).toBe('unsupported');
    expect(sa.moodleType).toBe('shortanswer');
    expect(sa.choices).toEqual([]);
    expect(sa.text).toBe('¿Cuál es el comando para listar archivos?');
    expect(sa.instruction).toBeNull();
  });

  it('resuelve imágenes relativas, quita la query y conserva las de otro dominio', () => {
    const page = parse('edge-cases');
    const q3 = page.questions[2]!;
    expect(q3.images).toEqual([
      { url: `${ORIGIN}/pluginfile.php/1/question/questiontext/500/4/9/diagrama%20red.png`, alt: 'Diagrama de red' },
      { url: 'https://cdn.example.org/logo.png', alt: 'Logo externo' },
    ]);
    expect(q3.choices[0]).toEqual({
      letter: 'a',
      text: '',
      selected: false,
      inputId: 'q500:4_answer0',
      images: [{ url: `${ORIGIN}/pluginfile.php/1/question/answer/500/4/11/opcion.png`, alt: 'Opción con imagen' }],
    });
  });

  it('marca como seleccionadas las casillas que ya estaban marcadas', () => {
    const page = parse('edge-cases');
    const q4 = page.questions[3]!;
    expect(q4.kind).toBe('multiple_choice');
    expect(q4.choices.map((c) => c.selected)).toEqual([true, false, true]);
    expect(q4.choices[2]!.text).toBe('UDP.');
  });
});

describe('readNavigation', () => {
  it('una sola página libre: todas las preguntas en la página 0', () => {
    const nav = readNavigation(loadFixture('dsop-02'));
    expect(nav.entries).toHaveLength(10);
    expect(nav.pages).toEqual([0]);
    expect(nav.currentPage).toBe(0);
    expect(nav.mode).toBe('free');
  });

  it('multipágina: sabe en qué página está cada pregunta y cuál se muestra', () => {
    const nav = readNavigation(loadFixture('multipage-free-p1'));
    expect(nav.pages).toEqual([0, 1]);
    expect(nav.currentPage).toBe(1);
    expect(nav.entries.filter((e) => e.page === 1).map((e) => e.number)).toEqual([6, 7, 8, 9, 10]);
  });

  it('sin la clase free la navegación es secuencial', () => {
    expect(readNavigation(loadFixture('multipage-seq-p0')).mode).toBe('sequential');
  });

  it('ignora el botón "i" de los bloques de información', () => {
    expect(readNavigation(loadFixture('edge-cases')).entries.map((e) => e.number)).toEqual([1, 2, 3, 4]);
  });

  it('sin bloque de navegación usa la página actual y modo secuencial', () => {
    const nav = readNavigation(
      new DOMParser().parseFromString('<input type="hidden" name="thispage" value="2">', 'text/html'),
    );
    expect(nav).toEqual({ entries: [], pages: [2], currentPage: 2, mode: 'sequential' });
  });
});
