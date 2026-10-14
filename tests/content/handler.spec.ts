import { strFromU8, unzipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRequest, type ContentEnv } from '@/content/handler';
import { fromBase64 } from '@/shared/base64';
import { FIXTURE_URL, htmlDocument, imageResponse, loadFixture, PNG_BYTES, type FixtureName } from '../helpers';

function env(name: FixtureName, overrides: Partial<ContentEnv> = {}): ContentEnv {
  return {
    doc: loadFixture(name),
    url: FIXTURE_URL[name],
    loadPage: vi.fn(async (url: string) => loadFixture('multipage-free-p1', url)),
    fetchImage: vi.fn(async () => imageResponse(PNG_BYTES)),
    ...overrides,
  };
}
afterEach(() => vi.restoreAllMocks());

const exportRequest = { type: 'mqx:export', detailed: false, generatorVersion: '0.1.0', exportedAt: '2026-10-13T12:00:00.000Z' } as const;

describe('handleRequest', () => {
  it('status describe la pestaña', async () => {
    expect(await handleRequest({ type: 'mqx:status' }, env('dsop-02'))).toMatchObject({ kind: 'attempt', total: 10 });
  });

  it('export de un intento multipágina devuelve un ZIP con todas las preguntas', async () => {
    const e = env('multipage-free-p0');
    const reply = await handleRequest(exportRequest, e);
    expect(reply).toMatchObject({ ok: true, questions: 10, warnings: [] });
    if (!('ok' in reply) || !reply.ok || !('zipBase64' in reply)) throw new Error('respuesta inesperada');
    const files = unzipSync(fromBase64(reply.zipBase64));
    const json = JSON.parse(strFromU8(files[reply.fileName.replace(/\.zip$/, '/quiz.json')]!));
    expect(json.pages).toEqual([0, 1]);
    expect(e.fetchImage).toHaveBeenCalledTimes(1);
  });

  it('export fuera de un intento no hace nada y lo dice', async () => {
    const e = env('dsop-02', { doc: htmlDocument('<p>curso</p>') });
    expect(await handleRequest(exportRequest, e)).toEqual({ ok: false, error: 'not-attempt' });
    expect(e.fetchImage).not.toHaveBeenCalled();
  });

  it('export con la sesión caducada lo dice', async () => {
    const e = env('dsop-02', { doc: htmlDocument('<form id="login"><input name="password"></form>') });
    expect(await handleRequest(exportRequest, e)).toEqual({ ok: false, error: 'login' });
  });

  it('si la exportación falla de forma inesperada responde failed', async () => {
    const e = env('dsop-02', {
      fetchImage: vi.fn(async () => {
        throw new Error('x');
      }),
    });
    vi.spyOn(JSON, 'stringify').mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(await handleRequest(exportRequest, e)).toEqual({ ok: false, error: 'failed' });
  });

  it('preview planifica sin tocar la página', async () => {
    const e = env('dsop-02');
    const reply = await handleRequest({ type: 'mqx:preview', answers: '2. c\nhola' }, e);
    expect(reply).toMatchObject({
      ok: true,
      report: null,
      parseErrors: [{ line: 2, text: 'hola', reason: 'format' }],
      plan: { steps: [{ number: 2 }], issues: [] },
    });
    expect((e.doc.getElementById('q13963:2_answer2') as HTMLInputElement).checked).toBe(false);
  });

  it('apply aplica en la página y devuelve el reporte', async () => {
    const e = env('multipage-free-p0');
    const reply = await handleRequest({ type: 'mqx:apply', answers: '2. c\n7. a' }, e);
    expect(reply).toMatchObject({
      ok: true,
      report: { applied: [2], failed: [] },
      plan: { issues: [{ number: 7, reason: 'other-page', page: 1 }] },
    });
    expect((e.doc.getElementById('q13963:2_answer2') as HTMLInputElement).checked).toBe(true);
    expect(e.loadPage).not.toHaveBeenCalled();
  });

  it('autollenar fuera de un intento no hace nada', async () => {
    const e = env('dsop-02', { doc: htmlDocument('<p>curso</p>') });
    expect(await handleRequest({ type: 'mqx:apply', answers: '1. a' }, e)).toEqual({ ok: false, error: 'not-attempt' });
  });
});
