// tests/unit/control-applicator.spec.ts

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { applyStep } from '~/moodle/applicators/control-applicator';
import type { ApplyStep } from '~/autofill/apply-plan';

function makeStep(overrides: Partial<ApplyStep>): ApplyStep {
  return {
    questionFingerprint: 'a'.repeat(64),
    questionNumber: 1,
    kind: 'radio',
    value: ['b'],
    sourceLine: 1,
    ...overrides,
  };
}

function makeRoot(html: string): HTMLElement {
  const { window } = new JSDOM(html, { url: 'https://m.example.edu/mod/quiz/attempt.php' });
  return window.document.querySelector('.que') as HTMLElement;
}

describe('applyStep — radio', () => {
  it('clicks the matching radio and confirms it is checked', () => {
    const root = makeRoot(`
      <div class="que">
        <div class="answer">
          <div class="r0"><span class="answernumber">a.</span><input type="radio" name="q1:1_answer" value="0" /><label>a</label></div>
          <div class="r0"><span class="answernumber">b.</span><input type="radio" name="q1:1_answer" value="1" /><label>b</label></div>
        </div>
      </div>
    `);
    const r = applyStep({ root, step: makeStep({ value: ['b'] }) });
    expect(r.ok).toBe(true);
    const checked = root.querySelector<HTMLInputElement>('input[value="1"]');
    expect(checked?.checked).toBe(true);
  });

  it('returns MQX-FILL-301 when the letter is missing', () => {
    const root = makeRoot(`
      <div class="que">
        <div class="answer">
          <div class="r0"><span class="answernumber">a.</span><input type="radio" name="q1:1_answer" value="0" /></div>
        </div>
      </div>
    `);
    const r = applyStep({ root, step: makeStep({ value: ['z'] }) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('MQX-FILL-301');
  });
});

describe('applyStep — checkbox', () => {
  it('clicks multiple checkboxes and confirms all are checked', () => {
    const root = makeRoot(`
      <div class="que">
        <div class="answer">
          <div class="r0"><span class="answernumber">a.</span><input type="checkbox" name="q1:1_choice1" value="0" /></div>
          <div class="r0"><span class="answernumber">b.</span><input type="checkbox" name="q1:1_choice2" value="1" /></div>
          <div class="r0"><span class="answernumber">c.</span><input type="checkbox" name="q1:1_choice3" value="2" /></div>
        </div>
      </div>
    `);
    const r = applyStep({ root, step: makeStep({ kind: 'checkbox', value: ['a', 'c'] }) });
    expect(r.ok).toBe(true);
    expect(root.querySelector<HTMLInputElement>('input[value="0"]')?.checked).toBe(true);
    expect(root.querySelector<HTMLInputElement>('input[value="1"]')?.checked).toBe(false);
    expect(root.querySelector<HTMLInputElement>('input[value="2"]')?.checked).toBe(true);
  });
});

describe('applyStep — short_text', () => {
  it('sets the value of <input type=text> and confirms', () => {
    const root = makeRoot(`
      <div class="que">
        <div class="answer"><input type="text" name="q1:1_answer" /></div>
      </div>
    `);
    const r = applyStep({ root, step: makeStep({ kind: 'short_text', value: 'París' }) });
    expect(r.ok).toBe(true);
    expect(root.querySelector<HTMLInputElement>('input[type=text]')?.value).toBe('París');
  });
});

describe('applyStep — long_text', () => {
  it('sets the value of <textarea> and confirms', () => {
    const root = makeRoot(`
      <div class="que">
        <div class="answer"><textarea name="q1:1_answer"></textarea></div>
      </div>
    `);
    const r = applyStep({ root, step: makeStep({ kind: 'long_text', value: 'Mi respuesta larga' }) });
    expect(r.ok).toBe(true);
    expect(root.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Mi respuesta larga');
  });
});

describe('applyStep — select', () => {
  it('selects the matching option and confirms', () => {
    const root = makeRoot(`
      <div class="que">
        <div class="answer">
          <select name="q1:1_answer">
            <option value=""></option>
            <option value="0">a. Red</option>
            <option value="1">b. Blue</option>
          </select>
        </div>
      </div>
    `);
    const r = applyStep({ root, step: makeStep({ kind: 'select', value: ['b'] }) });
    expect(r.ok).toBe(true);
    expect(root.querySelector<HTMLSelectElement>('select')?.value).toBe('1');
  });

  it('returns MQX-FILL-301 when the option letter is missing', () => {
    const root = makeRoot(`
      <div class="que">
        <div class="answer">
          <select name="q1:1_answer">
            <option value=""></option>
            <option value="0">a. Red</option>
          </select>
        </div>
      </div>
    `);
    const r = applyStep({ root, step: makeStep({ kind: 'select', value: ['z'] }) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('MQX-FILL-301');
  });
});

describe('applyStep — error paths', () => {
  it('returns MQX-FILL-301 when no input is found for short_text', () => {
    const root = makeRoot(`
      <div class="que"><div class="answer"></div></div>
    `);
    const r = applyStep({ root, step: makeStep({ kind: 'short_text', value: 'hola' }) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('MQX-FILL-301');
  });

  it('returns MQX-FILL-301 when no textarea is found for long_text', () => {
    const root = makeRoot(`
      <div class="que"><div class="answer"></div></div>
    `);
    const r = applyStep({ root, step: makeStep({ kind: 'long_text', value: 'hola' }) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('MQX-FILL-301');
  });

  it('returns MQX-FILL-301 when no select is found', () => {
    const root = makeRoot(`
      <div class="que"><div class="answer"></div></div>
    `);
    const r = applyStep({ root, step: makeStep({ kind: 'select', value: ['a'] }) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('MQX-FILL-301');
  });
});