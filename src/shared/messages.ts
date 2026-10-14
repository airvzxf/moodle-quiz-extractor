// Textos para la persona. Única fuente de los mensajes que muestran el popup y
// el Markdown detallado. Las páginas se guardan desde 0 y se muestran desde 1.
import type { ExportWarning } from '@/domain/types';
import type { ApplyFailure, FillIssue, LineError } from '@/autofill/types';

export function describeWarning(w: ExportWarning): string {
  switch (w.code) {
    case 'page-unavailable':
      return `No se pudo leer la página ${Number(w.detail) + 1}.`;
    case 'sequential-navigation':
      return `Navegación secuencial: sólo se exportó la página ${Number(w.detail) + 1}.`;
    case 'unsupported-question':
      return `La pregunta ${w.detail} tiene un tipo no soportado; se exportó sin opciones.`;
    case 'image-not-downloaded':
      return `No se descargó la imagen ${w.detail}; se enlaza la dirección original.`;
  }
}

export function describeLineError(e: LineError): string {
  return e.reason === 'duplicate'
    ? `Línea ${e.line}: esa pregunta ya tenía respuesta en una línea anterior.`
    : `Línea ${e.line}: formato no reconocido («${e.text}»).`;
}

export function describeIssue(i: FillIssue): string {
  switch (i.reason) {
    case 'other-page':
      return `Pregunta ${i.number}: está en la página ${(i.page ?? 0) + 1}. Ve a esa página y vuelve a aplicar.`;
    case 'not-in-quiz':
      return `Pregunta ${i.number}: no existe en este cuestionario.`;
    case 'unsupported':
      return `Pregunta ${i.number}: su tipo no se puede autollenar.`;
    case 'unknown-letter':
      return `Pregunta ${i.number}: la opción «${i.letter ?? ''}» no existe.`;
    case 'too-many-letters':
      return `Pregunta ${i.number}: admite una sola respuesta y la lista trae varias.`;
  }
}

export function describeFailure(f: ApplyFailure): string {
  return f.reason === 'missing-input'
    ? `Pregunta ${f.number}: no se encontró el control en la página.`
    : `Pregunta ${f.number}: no se pudo confirmar la selección.`;
}
