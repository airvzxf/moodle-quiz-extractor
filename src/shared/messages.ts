// Textos para la persona. Única fuente de los mensajes que muestran el popup y
// el Markdown detallado. Las páginas se guardan desde 0 y se muestran desde 1.
import type { ExportWarning } from '@/domain/types';
import type { ApplyFailure, FillIssue, LineError } from '@/autofill/types';

export function describeWarning(w: ExportWarning): string {
  throw new Error('not implemented');
}

export function describeLineError(e: LineError): string {
  throw new Error('not implemented');
}

export function describeIssue(i: FillIssue): string {
  throw new Error('not implemented');
}

export function describeFailure(f: ApplyFailure): string {
  throw new Error('not implemented');
}
