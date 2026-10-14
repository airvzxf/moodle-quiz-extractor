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
  const entries: AnswerEntry[] = [];
  const errors: LineError[] = [];
  const seen = new Set<number>();

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = index + 1;
    const trimmed = rawLine.trim();
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('//')) return;

    const match = trimmed.match(/^(\d+)\s*[.):-]?\s*(.*)$/);
    const number = match?.[1] ? Number.parseInt(match[1], 10) : 0;
    const tokens = (match?.[2] ?? '').split(/[\s,;]+/).filter((t) => t !== '');
    const letters: string[] = [];
    let valid = number >= 1 && tokens.length > 0;
    for (const token of tokens) {
      const m = token.match(/^([a-z])[.)]?$/i);
      if (!m?.[1]) {
        valid = false;
        break;
      }
      const letter = m[1].toLowerCase();
      if (!letters.includes(letter)) letters.push(letter);
    }

    if (!valid) {
      errors.push({ line, text: trimmed, reason: 'format' });
    } else if (seen.has(number)) {
      errors.push({ line, text: trimmed, reason: 'duplicate' });
    } else {
      seen.add(number);
      entries.push({ number, letters, line });
    }
  });

  return { entries, errors };
}
