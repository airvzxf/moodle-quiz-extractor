import { describe, expect, it } from 'vitest';
import { parseAnswerList } from '@/autofill/answer-list';
import { buildFillPlan } from '@/autofill/plan';
import { parseAttemptPage } from '@/moodle/parse-page';
import { FIXTURE_URL, loadFixture, type FixtureName } from '../helpers';

const plan = (name: FixtureName, text: string) =>
  buildFillPlan(parseAnswerList(text).entries, parseAttemptPage(loadFixture(name), FIXTURE_URL[name]));

describe('buildFillPlan', () => {
  it('una opción: marca sólo el radio de esa letra', () => {
    expect(plan('dsop-02', '2. c').steps).toEqual([
      { number: 2, kind: 'single_choice', check: ['q13963:2_answer2'], uncheck: [] },
    ]);
  });

  it('varias opciones: marca las pedidas y desmarca el resto, en orden de opciones', () => {
    expect(plan('dsop-02', '1. d, a').steps).toEqual([
      {
        number: 1,
        kind: 'multiple_choice',
        check: ['q13963:10_choice0', 'q13963:10_choice3'],
        uncheck: ['q13963:10_choice1', 'q13963:10_choice2'],
      },
    ]);
  });

  it('ordena pasos y problemas por número de pregunta', () => {
    const p = plan('dsop-02', '3. a\n2. b\n12. a\n11. a');
    expect(p.steps.map((s) => s.number)).toEqual([2, 3]);
    expect(p.issues.map((i) => i.number)).toEqual([11, 12]);
  });

  it('una pregunta de otra página no se aplica y dice en qué página está', () => {
    const p = plan('multipage-free-p0', '1. a\n7. b');
    expect(p.steps.map((s) => s.number)).toEqual([1]);
    expect(p.issues).toEqual([{ number: 7, reason: 'other-page', page: 1 }]);
  });

  it('un número que no existe en el cuestionario se informa', () => {
    expect(plan('dsop-02', '42. a').issues).toEqual([{ number: 42, reason: 'not-in-quiz' }]);
  });

  it('rechaza letras inexistentes, varias letras en una de opción única y tipos no soportados', () => {
    expect(plan('dsop-02', '2. z').issues).toEqual([{ number: 2, reason: 'unknown-letter', letter: 'z' }]);
    expect(plan('dsop-02', '2. a,b').issues).toEqual([{ number: 2, reason: 'too-many-letters' }]);
    expect(plan('edge-cases', '2. a').issues).toEqual([{ number: 2, reason: 'unsupported' }]);
    expect(plan('dsop-02', '2. z').steps).toEqual([]);
  });

  it('verdadero/falso se autollena con a y b', () => {
    expect(plan('edge-cases', '1. b').steps).toEqual([
      { number: 1, kind: 'single_choice', check: ['q500:1_answerfalse'], uncheck: [] },
    ]);
  });
});
