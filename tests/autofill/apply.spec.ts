import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyFillPlan } from '@/autofill/apply';
import { parseAnswerList } from '@/autofill/answer-list';
import { buildFillPlan } from '@/autofill/plan';
import { parseAttemptPage } from '@/moodle/parse-page';
import { FIXTURE_URL, loadFixture, type FixtureName } from '../helpers';

function setup(name: FixtureName, text: string) {
  const doc = loadFixture(name);
  const plan = buildFillPlan(parseAnswerList(text).entries, parseAttemptPage(doc, FIXTURE_URL[name]));
  return { doc, plan };
}
const checked = (doc: Document, id: string) => (doc.getElementById(id) as HTMLInputElement).checked;

afterEach(() => vi.restoreAllMocks());

describe('applyFillPlan', () => {
  it('marca el radio pedido y confirma', () => {
    const { doc, plan } = setup('dsop-02', '2. c');
    expect(applyFillPlan(doc, plan)).toEqual({ applied: [2], failed: [] });
    expect(checked(doc, 'q13963:2_answer2')).toBe(true);
    expect(checked(doc, 'q13963:2_answer-1')).toBe(false);
  });

  it('deja las casillas exactamente como dice la lista, aunque ya hubiera otras marcadas', () => {
    const { doc, plan } = setup('edge-cases', '4. b');
    expect(applyFillPlan(doc, plan)).toEqual({ applied: [4], failed: [] });
    expect(['q500:5_choice0', 'q500:5_choice1', 'q500:5_choice2'].map((id) => checked(doc, id))).toEqual([false, true, false]);
  });

  it('dispara los eventos change como lo haría un clic de la persona', () => {
    const { doc, plan } = setup('dsop-02', '2. c\n1. a,b');
    const changes: string[] = [];
    doc.addEventListener('change', (e) => changes.push((e.target as HTMLInputElement).id));
    applyFillPlan(doc, plan);
    expect(changes).toEqual(['q13963:10_choice0', 'q13963:10_choice1', 'q13963:2_answer2']);
  });

  it('volver a aplicar la misma lista no cambia nada ni dispara eventos', () => {
    const { doc, plan } = setup('dsop-02', '2. c\n1. a,b');
    applyFillPlan(doc, plan);
    const changes: string[] = [];
    doc.addEventListener('change', (e) => changes.push((e.target as HTMLInputElement).id));
    expect(applyFillPlan(doc, plan)).toEqual({ applied: [1, 2], failed: [] });
    expect(changes).toEqual([]);
  });

  it('si falta un control no toca esa pregunta y lo informa', () => {
    const { doc, plan } = setup('edge-cases', '4. a,b');
    doc.getElementById('q500:5_choice1')!.remove();
    expect(applyFillPlan(doc, plan)).toEqual({ applied: [], failed: [{ number: 4, reason: 'missing-input' }] });
    expect(checked(doc, 'q500:5_choice2')).toBe(true);
  });

  it('si un control está deshabilitado informa que no se pudo confirmar', () => {
    const { doc, plan } = setup('dsop-02', '2. c');
    (doc.getElementById('q13963:2_answer2') as HTMLInputElement).disabled = true;
    expect(applyFillPlan(doc, plan)).toEqual({ applied: [], failed: [{ number: 2, reason: 'not-confirmed' }] });
  });

  it('nunca envía el formulario del intento', () => {
    const { doc, plan } = setup('dsop-02', '1. a,c\n2. b\n3. d\n4. a\n5. b\n6. c\n7. d\n8. a\n9. b\n10. c');
    const view = doc.defaultView!;
    const submit = vi.spyOn(view.HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
    const requestSubmit = vi.spyOn(view.HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    const onSubmit = vi.fn((e: Event) => e.preventDefault());
    doc.addEventListener('submit', onSubmit);
    const buttonClicks = vi.fn();
    doc.querySelectorAll('input[type="submit"], button').forEach((b) => b.addEventListener('click', buttonClicks));

    expect(applyFillPlan(doc, plan).applied).toHaveLength(10);
    expect(submit).not.toHaveBeenCalled();
    expect(requestSubmit).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(buttonClicks).not.toHaveBeenCalled();
  });
});
