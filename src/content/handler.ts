import { applyFillPlan } from '@/autofill/apply';
import { parseAnswerList } from '@/autofill/answer-list';
import { buildFillPlan } from '@/autofill/plan';
import { exportQuiz } from '@/export/export-quiz';
import type { FetchImage } from '@/export/assets';
import type { ExportReply, FillReply, MqxReply, MqxRequest } from '@/messaging/protocol';
import { collectQuiz, type LoadPage } from '@/moodle/collect';
import { parseAttemptPage } from '@/moodle/parse-page';
import { readStatus } from '@/moodle/status';
import { toBase64 } from '@/shared/base64';

/** Todo lo que el manejador necesita del navegador. */
export interface ContentEnv {
  doc: Document;
  /** URL actual de la pestaña. */
  url: string;
  loadPage: LoadPage;
  fetchImage: FetchImage;
}

/**
 * Atiende una petición del popup. Cada petición vuelve a leer el DOM: no hay
 * estado entre llamadas.
 * - 'mqx:status'  → readStatus(doc, url)
 * - 'mqx:export'  → si el estado no es 'attempt': {ok:false, error: 'login'|'not-attempt'};
 *                   si no, collectQuiz + exportQuiz → {ok:true, fileName, zipBase64,
 *                   questions: nº de preguntas, warnings: los del documento exportado};
 *                   si algo lanza: {ok:false, error:'failed'}.
 * - 'mqx:preview' → parseAnswerList + buildFillPlan, report = null. No toca la página.
 * - 'mqx:apply'   → igual que preview y además report = applyFillPlan(doc, plan).
 */
export async function handleRequest(req: MqxRequest, env: ContentEnv): Promise<MqxReply> {
  const status = readStatus(env.doc, env.url);
  if (req.type === 'mqx:status') return status;

  if (req.type === 'mqx:export') {
    if (status.kind !== 'attempt') return { ok: false, error: status.kind } satisfies ExportReply;
    try {
      const page = parseAttemptPage(env.doc, env.url);
      const doc = await collectQuiz(page, env.url, env.loadPage);
      const result = await exportQuiz(doc, env.fetchImage, {
        detailed: req.detailed,
        generatorVersion: req.generatorVersion,
        exportedAt: req.exportedAt,
      });
      return {
        ok: true,
        fileName: result.fileName,
        zipBase64: toBase64(result.zip),
        questions: result.document.questions.length,
        warnings: result.document.warnings,
      } satisfies ExportReply;
    } catch {
      return { ok: false, error: 'failed' } satisfies ExportReply;
    }
  }

  if (status.kind !== 'attempt') return { ok: false, error: status.kind } satisfies FillReply;
  const parsed = parseAnswerList(req.answers);
  const plan = buildFillPlan(parsed.entries, parseAttemptPage(env.doc, env.url));
  const report = req.type === 'mqx:apply' ? applyFillPlan(env.doc, plan) : null;
  return { ok: true, parseErrors: parsed.errors, plan, report } satisfies FillReply;
}
