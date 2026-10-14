import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import type { QuizDocument } from '@/domain/types';
import { exportQuiz, slugFor } from '@/export/export-quiz';
import { renderMarkdown } from '@/export/markdown';
import { collectQuiz } from '@/moodle/collect';
import { parseAttemptPage } from '@/moodle/parse-page';
import { FIXTURE_URL, imageResponse, loadFixture, PNG_BYTES, type FixtureName } from '../helpers';

const opts = { detailed: false, generatorVersion: '0.1.0', exportedAt: '2026-10-13T12:00:00.000Z' };
const docOf = (n: FixtureName): Promise<QuizDocument> =>
  collectQuiz(parseAttemptPage(loadFixture(n), FIXTURE_URL[n]), FIXTURE_URL[n], vi.fn());

describe('slugFor', () => {
  it('une curso, unidad y título sin acentos ni símbolos', async () => {
    expect(slugFor(await docOf('dsop-02'))).toBe('02-sistemas-operativos-dsop-unidad-1-actividad-1-cuestionario');
  });

  it('corta a 80 caracteres sin dejar guion final y usa "cuestionario" si no queda nada', async () => {
    const doc = await docOf('edge-cases');
    expect(slugFor({ ...doc, course: null, title: '¿¿??' })).toBe('cuestionario');
    const long = slugFor({ ...doc, course: null, title: `${'a'.repeat(79)} b` });
    expect(long).toBe('a'.repeat(79));
  });
});

describe('exportQuiz', () => {
  it('genera una carpeta con quiz.md, quiz.json y las imágenes descargadas', async () => {
    const doc = await docOf('dsop-02');
    const result = await exportQuiz(doc, async () => imageResponse(PNG_BYTES), opts);
    const slug = '02-sistemas-operativos-dsop-unidad-1-actividad-1-cuestionario';
    expect(result.fileName).toBe(`${slug}.zip`);
    const files = unzipSync(result.zip);
    expect(Object.keys(files).sort()).toEqual([`${slug}/quiz.json`, `${slug}/quiz.md`, `${slug}/quiz/A2_Examen_U1.png`]);
    expect(files[`${slug}/quiz/A2_Examen_U1.png`]).toEqual(PNG_BYTES);
    expect(strFromU8(files[`${slug}/quiz.md`]!)).toMatch(/!\[[^\]]*\]\(\.\/quiz\/A2_Examen_U1\.png\)/);
    expect(JSON.parse(strFromU8(files[`${slug}/quiz.json`]!))).toEqual(result.document);
    expect(strFromU8(files[`${slug}/quiz.json`]!).endsWith('}\n')).toBe(true);
  });

  it('el Markdown del ZIP es exactamente renderMarkdown con las rutas descargadas', async () => {
    const doc = await docOf('edge-cases');
    const result = await exportQuiz(doc, async () => imageResponse(PNG_BYTES), { ...opts, detailed: true });
    const md = strFromU8(unzipSync(result.zip)['curso-de-prueba-casos-limite/quiz.md']!);
    const imagePaths = new Map([
      ['https://moodle.example.test/pluginfile.php/1/question/questiontext/500/4/9/diagrama%20red.png', 'quiz/diagrama_red.png'],
      ['https://moodle.example.test/pluginfile.php/1/question/answer/500/4/11/opcion.png', 'quiz/opcion.png'],
      ['https://moodle.example.test/pluginfile.php/1/question/questiontext/500/5/9/diagrama%20red.png', 'quiz/diagrama_red-2.png'],
    ]);
    expect(md).toBe(renderMarkdown(result.document, { ...opts, detailed: true, imagePaths }));
  });

  it('añade al final los avisos de imágenes no descargadas', async () => {
    const doc = await docOf('edge-cases');
    const result = await exportQuiz(doc, async () => imageResponse(PNG_BYTES), opts);
    expect(result.document.warnings).toEqual([
      { code: 'unsupported-question', detail: '2' },
      { code: 'image-not-downloaded', detail: 'https://cdn.example.org/logo.png' },
    ]);
    expect(doc.warnings).toEqual([{ code: 'unsupported-question', detail: '2' }]);
  });

  it('es determinista: misma entrada, mismos bytes', async () => {
    const doc = await docOf('dsop-02');
    const a = await exportQuiz(doc, async () => imageResponse(PNG_BYTES), opts);
    const b = await exportQuiz(doc, async () => imageResponse(PNG_BYTES), opts);
    expect(a.zip).toEqual(b.zip);
  });

  it('ningún archivo exportado contiene la sesskey de la página', async () => {
    for (const name of ['dsop-02', 'edge-cases'] as const) {
      const result = await exportQuiz(await docOf(name), async () => imageResponse(PNG_BYTES), { ...opts, detailed: true });
      for (const bytes of Object.values(unzipSync(result.zip))) {
        expect(strFromU8(bytes, true)).not.toContain('SESSKEY_REDACTED');
      }
    }
  });
});
