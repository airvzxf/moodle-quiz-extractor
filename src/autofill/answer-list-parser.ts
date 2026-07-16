// src/autofill/answer-list-parser.ts
//
// Pure parser for the answer-list text format documented in README.md
// §"Formato de respuestas (autollenado)":
//
//   1. a)        # radio: one letter
//   2. c)        # radio: one letter
//   3. a,c       # checkbox: comma-separated letters
//   4. d)        # radio: one letter
//   5. Mi respuesta se basa en los fundamentos del desarrollo del software.
//
// Format details (BNF-ish):
//   line        = WS* INT WS* ('.' | ')') WS+ content LF
//   WS          = ' ' | '\t'
//   content     = letters | free-text
//   letters     = letter (WS* (',' | '-') WS* letter)*
//   letter      = 'a'..'z' | 'A'..'Z'
//   free-text   = anything else (multi-line answers are NOT supported;
//                 each question occupies exactly one line)
//
// The parser is pure: no DOM, no browser APIs. It returns a Result type
// instead of throwing so callers can collect every error at once and
// present them all in the preview (better UX than failing on the first
// typo).

import { MQX, type MqxCode } from '~/diagnostics/codes';

export type AnswerKind = 'letter' | 'letters' | 'text';

/** A single parsed answer, unvalidated against the QuizDocument. */
export interface ParsedAnswer {
  /** 1-based question number as typed by the user. */
  readonly questionNumber: number;
  /** Source line number (1-based) for error reporting. */
  readonly sourceLine: number;
  readonly kind: AnswerKind;
  /** For 'letter' and 'letters': lowercase letter(s). For 'text': raw text. */
  readonly value: ReadonlyArray<string> | string;
}

export interface AnswerListParseError {
  readonly code: MqxCode;
  readonly message: string;
  readonly sourceLine: number;
}

export type AnswerListResult =
  | { ok: true; answers: ReadonlyArray<ParsedAnswer>; warnings: ReadonlyArray<AnswerListParseError> }
  | { ok: false; errors: ReadonlyArray<AnswerListParseError> };

const LINE_PATTERN = /^\s*(\d+)\s*[\.\)]\s*(.+?)\s*$/;
// Content that contains ONLY the punctuation and whitespace we accept
// around letter lists. Real prose like "Mi respuesta..." also matches
// this, so we apply the additional rule that every non-empty token
// between separators must be exactly one letter.
const LETTERS_PUNCTUATION = /^[\sA-Za-z.,)\]\-]+$/;

export function parseAnswerList(input: string): AnswerListResult {
  const errors: AnswerListParseError[] = [];
  const answers: ParsedAnswer[] = [];
  const warnings: AnswerListParseError[] = [];

  // Strip BOM and normalize line endings.
  const cleaned = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = cleaned.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const lineNo = i + 1;
    const trimmed = raw.trim();

    // Empty lines and comments are ignored.
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const m = LINE_PATTERN.exec(raw);
    if (!m) {
      errors.push({
        code: MQX.PARSE_INVALID_LETTER,
        message: `línea ${lineNo}: no encaja con "<número>. <contenido>"`,
        sourceLine: lineNo,
      });
      continue;
    }

    const questionNumber = Number.parseInt(m[1]!, 10);
    const content = m[2]!.trim();

    if (LETTERS_PUNCTUATION.test(content)) {
      // Disambiguate "a, b, c" (letters) from "Mi respuesta..." (text):
      // a real letter list has every non-empty token between separators
      // being exactly one character.
      const tokens = content.split(/[\s,.)}\]\-]+/).filter((t) => t.length > 0);
      const allSingle = tokens.every((t) => t.length === 1 && /^[a-zA-Z]$/.test(t));
      if (allSingle && tokens.length > 0) {
        const seen = new Set<string>();
        const uniq: string[] = [];
        for (const t of tokens) {
          const l = t.toLowerCase();
          if (!seen.has(l)) {
            seen.add(l);
            uniq.push(l);
          }
        }
        if (uniq.length === 1) {
          answers.push({
            questionNumber,
            sourceLine: lineNo,
            kind: 'letter',
            value: uniq,
          });
        } else {
          answers.push({
            questionNumber,
            sourceLine: lineNo,
            kind: 'letters',
            value: uniq,
          });
        }
        continue;
      }
      if (tokens.length === 0) {
        warnings.push({
          code: MQX.PARSE_INVALID_LETTER,
          message: `línea ${lineNo}: sólo separadores, tratando como texto libre`,
          sourceLine: lineNo,
        });
      }
    }

    answers.push({
      questionNumber,
      sourceLine: lineNo,
      kind: 'text',
      value: content,
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, answers, warnings };
}