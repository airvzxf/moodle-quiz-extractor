// Mensajes entre el popup y el script inyectado en la pestaña. Sólo tipos.
// Todo lo que viaja debe ser serializable a JSON (Chrome serializa así):
// por eso el ZIP viaja como base64.
import type { ApplyReport, FillPlan, LineError } from '@/autofill/types';
import type { ExportWarning, PageStatus } from '@/domain/types';

export type MqxRequest =
  | { type: 'mqx:status' }
  | { type: 'mqx:export'; detailed: boolean; generatorVersion: string; exportedAt: string }
  | { type: 'mqx:preview'; answers: string }
  | { type: 'mqx:apply'; answers: string };

export type ExportReply =
  | {
      ok: true;
      fileName: string;
      zipBase64: string;
      questions: number;
      warnings: ExportWarning[];
    }
  | { ok: false; error: 'not-attempt' | 'login' | 'failed' };

export type FillReply =
  | {
      ok: true;
      parseErrors: LineError[];
      plan: FillPlan;
      /** null en 'mqx:preview' (no se toca la página). */
      report: ApplyReport | null;
    }
  | { ok: false; error: 'not-attempt' | 'login' };

export interface ReplyMap {
  'mqx:status': PageStatus;
  'mqx:export': ExportReply;
  'mqx:preview': FillReply;
  'mqx:apply': FillReply;
}

export type MqxReply = ReplyMap[keyof ReplyMap];
