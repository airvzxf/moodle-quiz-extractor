import type { AnswerEntry, LineError, ParsedAnswers } from '@/autofill/types';

/**
 * Interpreta la lista pegada por la persona, una respuesta por línea:
 *   "1. a)"  "2) B"  "3. a,c"  "4 a; c"  "5- d."
 * Reglas:
 * - Se ignoran líneas vacías y las que empiezan por "#" o "//" (tras recortar).
 * - Línea = número (>= 1), separador opcional [.):-], y una o más letras
 *   separadas por comas, punto y coma o espacios; cada letra puede llevar
 *   "." o ")" detrás. Cualquier otra cosa es {reason:'format'}.
 * - Letras en minúscula, sin repetir, en orden de aparición.
 * - Un número que ya apareció en una línea válida anterior es {reason:'duplicate'}
 *   y esa línea se descarta (gana la primera).
 * `entries` y `errors` quedan en orden de línea.
 */
export function parseAnswerList(text: string): ParsedAnswers {
  throw new Error('not implemented');
}
