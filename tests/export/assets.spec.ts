import { describe, expect, it, vi } from 'vitest';
import type { QuizDocument } from '@/domain/types';
import { fetchAssets, MAX_IMAGE_BYTES, planAssets } from '@/export/assets';
import { collectQuiz } from '@/moodle/collect';
import { parseAttemptPage } from '@/moodle/parse-page';
import { FIXTURE_URL, imageResponse, loadFixture, ORIGIN, PNG_BYTES } from '../helpers';

async function edgeDoc(): Promise<QuizDocument> {
  return collectQuiz(parseAttemptPage(loadFixture('edge-cases'), FIXTURE_URL['edge-cases']), FIXTURE_URL['edge-cases'], vi.fn());
}

describe('planAssets', () => {
  it('nombra cada imagen por su archivo, sin espacios raros, y desambigua repetidos', async () => {
    expect(planAssets(await edgeDoc())).toEqual([
      { url: `${ORIGIN}/pluginfile.php/1/question/questiontext/500/4/9/diagrama%20red.png`, path: 'quiz/diagrama_red.png' },
      { url: 'https://cdn.example.org/logo.png', path: 'quiz/logo.png' },
      { url: `${ORIGIN}/pluginfile.php/1/question/answer/500/4/11/opcion.png`, path: 'quiz/opcion.png' },
      { url: `${ORIGIN}/pluginfile.php/1/question/questiontext/500/5/9/diagrama%20red.png`, path: 'quiz/diagrama_red-2.png' },
    ]);
  });

  it('una misma URL usada dos veces se descarga una sola vez', async () => {
    const doc = await edgeDoc();
    const repeated = doc.questions[3]!.images[0]!;
    doc.questions[0]!.images.push(repeated);
    const plans = planAssets(doc);
    expect(plans.filter((p) => p.url === repeated.url)).toHaveLength(1);
  });

  it('usa "imagen" si la URL no tiene nombre de archivo y sufija sin extensión', async () => {
    const doc = await edgeDoc();
    doc.questions = [{ ...doc.questions[0]!, images: [{ url: `${ORIGIN}/`, alt: '' }, { url: `${ORIGIN}/x/`, alt: '' }] }];
    expect(planAssets(doc).map((p) => p.path)).toEqual(['quiz/imagen', 'quiz/imagen-2']);
  });
});

describe('fetchAssets', () => {
  const plans = [
    { url: `${ORIGIN}/pluginfile.php/a.png`, path: 'quiz/a.png' },
    { url: 'https://cdn.example.org/b.png', path: 'quiz/b.png' },
  ];

  it('descarga sólo las del mismo origen y avisa de las demás sin pedirlas', async () => {
    const fetchImage = vi.fn(async () => imageResponse(PNG_BYTES));
    const { files, warnings } = await fetchAssets(plans, ORIGIN, fetchImage);
    expect(fetchImage).toHaveBeenCalledTimes(1);
    expect(fetchImage).toHaveBeenCalledWith(`${ORIGIN}/pluginfile.php/a.png`);
    expect([...files.entries()]).toEqual([[`${ORIGIN}/pluginfile.php/a.png`, { path: 'quiz/a.png', bytes: PNG_BYTES }]]);
    expect(warnings).toEqual([{ code: 'image-not-downloaded', detail: 'https://cdn.example.org/b.png' }]);
  });

  it('rechaza respuestas que no son imágenes (p. ej. la página de acceso)', async () => {
    const { files, warnings } = await fetchAssets(plans.slice(0, 1), ORIGIN, async () =>
      imageResponse(new TextEncoder().encode('<html>login</html>'), 'text/html; charset=utf-8'),
    );
    expect(files.size).toBe(0);
    expect(warnings).toEqual([{ code: 'image-not-downloaded', detail: plans[0]!.url }]);
  });

  it('rechaza errores HTTP, fallos de red e imágenes demasiado grandes', async () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    const answers = [
      async () => imageResponse(PNG_BYTES, 'image/png', 404),
      async () => {
        throw new TypeError('network');
      },
      async () => imageResponse(big),
    ];
    for (const fetchImage of answers) {
      const { files, warnings } = await fetchAssets(plans.slice(0, 1), ORIGIN, fetchImage);
      expect(files.size).toBe(0);
      expect(warnings).toHaveLength(1);
    }
  });

  it('acepta el Content-Type en mayúsculas', async () => {
    const { files } = await fetchAssets(plans.slice(0, 1), ORIGIN, async () => imageResponse(PNG_BYTES, 'IMAGE/PNG'));
    expect(files.size).toBe(1);
  });
});
