import { describe, expect, it } from 'vitest';
import { parseAnswerList } from '@/autofill/answer-list';

describe('parseAnswerList', () => {
  it('acepta las formas habituales de escribir una respuesta', () => {
    const { entries, errors } = parseAnswerList(['1. a)', '2) B', '3. a,c', '4 a; c', '5- d.', '6:e', '7.f'].join('\n'));
    expect(errors).toEqual([]);
    expect(entries.map((e) => [e.number, e.letters])).toEqual([
      [1, ['a']],
      [2, ['b']],
      [3, ['a', 'c']],
      [4, ['a', 'c']],
      [5, ['d']],
      [6, ['e']],
      [7, ['f']],
    ]);
  });

  it('acepta letras separadas por espacios y con paréntesis', () => {
    expect(parseAnswerList('10. a) c) d)').entries).toEqual([{ number: 10, letters: ['a', 'c', 'd'], line: 1 }]);
  });

  it('quita letras repetidas conservando el orden', () => {
    expect(parseAnswerList('3. c, a, c').entries[0]!.letters).toEqual(['c', 'a']);
  });

  it('ignora líneas vacías y comentarios, y cuenta las líneas desde 1', () => {
    const { entries, errors } = parseAnswerList('# respuestas\n\n// unidad 1\n  2. b  \r\n');
    expect(errors).toEqual([]);
    expect(entries).toEqual([{ number: 2, letters: ['b'], line: 4 }]);
  });

  it('marca como formato no reconocido lo que no es número y letras', () => {
    const { entries, errors } = parseAnswerList(['a. 1', '5. Mi respuesta', '6.', '0. a', '7. ab', 'x'].join('\n'));
    expect(entries).toEqual([]);
    expect(errors.map((e) => [e.line, e.text, e.reason])).toEqual([
      [1, 'a. 1', 'format'],
      [2, '5. Mi respuesta', 'format'],
      [3, '6.', 'format'],
      [4, '0. a', 'format'],
      [5, '7. ab', 'format'],
      [6, 'x', 'format'],
    ]);
  });

  it('si una pregunta aparece dos veces gana la primera y la segunda es un error', () => {
    const { entries, errors } = parseAnswerList('1. a\n2. b\n1. c');
    expect(entries.map((e) => [e.number, e.letters])).toEqual([
      [1, ['a']],
      [2, ['b']],
    ]);
    expect(errors).toEqual([{ line: 3, text: '1. c', reason: 'duplicate' }]);
  });

  it('una lista vacía no produce nada', () => {
    expect(parseAnswerList('')).toEqual({ entries: [], errors: [] });
  });
});
