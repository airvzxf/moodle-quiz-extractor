// tests/unit/no-submit-spy.spec.ts
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { installNoSubmitSpy } from '~/moodle/applicators/no-submit-spy';

async function loadForm() {
  const html = await readFile('tests/fixtures/redacted/dsop-01-page-01.html', 'utf8');
  const { window } = new JSDOM(html, {
    url: 'https://ejemplo.mx/mod/quiz/attempt.php?attempt=__REDACTED__&cmid=__REDACTED__',
  });
  return window.document;
}

describe('no-submit invariant', () => {
  it('blocks form.submit() on the responseform', async () => {
    const document = await loadForm();
    const form = document.getElementById('responseform') as HTMLFormElement;
    const spy = installNoSubmitSpy(document);
    expect(() => form.submit()).toThrowError(/MQX-FILL-304/);
    expect(spy.blocked()).toBe(1);
    spy.uninstall();
  });

  it('blocks form.requestSubmit() and counts each block', async () => {
    const document = await loadForm();
    const form = document.getElementById('responseform') as HTMLFormElement;
    const spy = installNoSubmitSpy(document);
    expect(() => form.requestSubmit()).toThrowError(/MQX-FILL-304/);
    expect(() => form.requestSubmit()).toThrowError(/MQX-FILL-304/);
    expect(spy.blocked()).toBe(2);
    spy.uninstall();
  });

  it('disable() suppresses the block (e.g. when the user explicitly submits)', async () => {
    const document = await loadForm();
    const form = document.getElementById('responseform') as HTMLFormElement;
    const spy = installNoSubmitSpy(document);
    spy.disable();
    expect(() => form.submit()).not.toThrow();
    expect(spy.blocked()).toBe(0);
    spy.uninstall();
  });

  it('uninstall() permanently disables the spy', async () => {
    const document = await loadForm();
    const form = document.getElementById('responseform') as HTMLFormElement;
    const spy = installNoSubmitSpy(document);
    spy.uninstall();
    expect(() => form.submit()).not.toThrow();
    expect(spy.blocked()).toBe(0);
  });
});
