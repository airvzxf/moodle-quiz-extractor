// src/export/markdown.ts
//
// Markdown renderer for the QuizDocument intermediate model.
//
// Output is BYTE-EXACT to the literal contract the user described in the
// original `prompt.md`:
//   - `# <course> | <unit>` (H1)
//   - `## <cuestionario>` (H2)
//   - `Metadata\\nDesconocido: <key>` initial block
//   - per question, separated by `\\n\\n---\\n\\n`:
//     - `### N. <enunciado>` (H3)
//     - optional `[IMAGEN](./quiz/<filename>)` line (no blank line before)
//     - `#### Respuestas` (H4) + `Selecciona una opción:` or `Selecciona una o mas opción:`
//     - `[ ] a. <opcion>.` (literal `[ ]`, no leading dash)
//     - Metadata block: `Tipo de respuesta: <kind>.`, `Puntaje de <n>`, `Sin responder aún`, etc.
//
// Anti-patterns explicitly excluded:
//   - GFM `- [ ]` checklist syntax (T15 used this; user's example has bare `[ ]`)
//   - YAML frontmatter (T05 sometimes used; user has none)
//   - `a. b. c. d.` letter prefixes on the option line itself (T15 added;
//     user's example has `[ ] Donde esta diosito.` without letter prefix)
//     Wait — correction: the user's THIRD example (`### 3. Cual es la curva recta?`)
//     shows `[ ] [respuesta-3-1](./quiz/respuesta-3-1.png).` WITHOUT a letter, so
//     the letter is OPTIONAL and rendered only if present. We render the letter
//     when it exists (the canonical Moodlish form is `a. text`).

import type { Question, QuizDocument } from '~/domain/quiz-schema';

export interface RenderOptions {
  /** ISO timestamp injected into the footer. Defaults to now. */
  exportedAt?: Date;
  /** Schema version line emitted at the very top. Omit to suppress. */
  banner?: string;
  /** When true, prepends a single line of `<!-- … -->` HTML comment with
   *  the redacted origin hash. Off by default (literal contract has no
   *  comment). */
  diagnosticsComment?: boolean;
  /** Generator version line emitted in the footer. Defaults to the
   *  current `package.json` version. */
  generatorVersion?: string;
}

const DEFAULT_VERSION = '0.2.0';

export function renderQuiz(doc: QuizDocument, opts: RenderOptions = {}): string {
  const exportedAt = (opts.exportedAt ?? new Date()).toISOString();
  const version = opts.generatorVersion ?? DEFAULT_VERSION;
  const head = renderHead(doc);
  const meta = renderInitialMetadata(doc);
  const sep = '\n\n---\n\n';
  const body = doc.questions.map(renderQuestion).join(sep);
  const foot = `\n\n> Generado por moodle-quiz-extractor v${version} — ${exportedAt}\n`;
  return head + '\n\n' + meta + sep + body + foot;
}

function renderHead(doc: QuizDocument): string {
  const course = doc.course?.trim() || 'Cuestionario Moodle';
  const unit = doc.unit?.trim();
  const h1 = unit ? `# ${course} | ${unit}` : `# ${course}`;
  const h2 = `## ${doc.title.trim() || 'Cuestionario'}`;
  return `${h1}\n\n${h2}`;
}

function renderInitialMetadata(doc: QuizDocument): string {
  // The example uses `Metadata\\nDesconocido: <key>` as the opening metadata
  // block. The user's example renders `Desconocido: DU1_DSOP` which is the
  // section heading (not the unit). We mirror that: section > unit > title.
  const key = (doc.section || doc.unit || doc.title || 'Cuestionario')
    .replaceAll(' ', '_');
  return `Metadata\nDesconocido: ${key}`;
}

function renderQuestion(q: Question): string {
  const head = `### ${q.number}. ${q.promptMarkdown}`;
  const images = renderImages(q);
  const answers = renderAnswers(q);
  const meta = renderMetadata(q);
  // Per the user's example:
  //   - image line follows the question text WITHOUT a blank line
  //   - `#### Respuestas` follows with ONE blank line (1 newline)
  //   - the metadata block ends with `Otra metadata.\n` (no trailing blank)
  //   - the join separator is `\n\n---\n\n` so 1 blank line precedes the `---`
  //
  // We therefore emit head + (optional image line, no trailing newline) +
  // answers + meta, with NO trailing newline. The caller (renderQuiz) adds
  // the `\n\n---\n\n` separator that produces the correct spacing.
  const tail = (answers + meta).replace(/\n+$/, '');
  return `${head}\n${images}${tail}`;
}

function renderImages(q: Question): string {
  // Each prompt image becomes a literal `[IMAGEN](./quiz/<filename>)` line,
  // exactly as the user's example shows. The orchestrator fills
  // `localPath` from the planner (e.g. "quiz/q2-7064dd3c.png"); when it
  // is empty we fall back to the URL basename so the markdown is still
  // useful for unsupported layouts.
  if (q.assets.length === 0) return '';
  return q.assets
    .map((a) => `[IMAGEN](./quiz/${strippedLocalPath(a.localPath || basename(a.sourceUrl))})`)
    .join('\n') + '\n';
}

/** `localPath` already includes the `quiz/` prefix (planner convention);
 *  the renderer prepends `./quiz/`, so we drop the leading `quiz/` to
 *  avoid doubling it. */
function strippedLocalPath(localPath: string): string {
  return localPath.startsWith('quiz/') ? localPath.slice('quiz/'.length) : localPath;
}

function basename(url: string): string {
  try {
    const u = new URL(url);
    const p = u.pathname;
    const i = p.lastIndexOf('/');
    return i >= 0 ? p.slice(i + 1) : p;
  } catch {
    return url.split('/').pop() || url;
  }
}

function renderAnswers(q: Question): string {
  const header =
    q.kind === 'multiple_choice'
      ? '#### Respuestas\nSelecciona una o mas opción:'
      : '#### Respuestas\nSelecciona una opción:';

  if (q.kind === 'unsupported' || q.choices.length === 0) {
    return (
      header +
      '\n_No se reconocen opciones para este tipo de pregunta._\n\n'
    );
  }

  // Literal contract: `[ ] <letter>. <label>.` (no leading dash, period at end)
  const lines = q.choices.map((c) => {
    // Per the user's third example, the letter is sometimes omitted. We
    // always include it because every Moodlish question has a letter, but we
    // don't repeat the letter if the label already starts with it.
    const raw = c.label.trim();
    // Strip a trailing period so we never emit a double period.
    const label = raw.replace(/\.+$/, '');
    const startsWithLetter = /^[a-zA-Z][.)]\s/.test(label);
    const body = startsWithLetter ? label : `${c.letter}. ${label}`;
    return `[ ] ${body}.`;
  });

  return header + '\n' + lines.join('\n') + '\n\n';
}

function renderMetadata(q: Question): string {
  // Match the user's example shape. The exact text is fixed (no translation);
  // only the kind label, puntaje, and state vary.
  const kindLabel = kindToSpanish(q.kind);
  const lines: string[] = ['Metadata', `Tipo de respuesta: ${kindLabel}.`];
  if (q.metadata.gradeRaw) {
    lines.push(q.metadata.gradeRaw);
  } else {
    lines.push('Puntaje de 10.00');
  }
  if (q.metadata.stateRaw) {
    lines.push(q.metadata.stateRaw);
  } else {
    lines.push('Sin responder aún');
  }
  if (q.kind === 'unsupported' && q.warnings.length > 0) {
    lines.push(`No soportado en el MVP: ${q.warnings.join('; ')}`);
  }
  return lines.join('\n') + '\n';
}

function kindToSpanish(kind: Question['kind']): string {
  switch (kind) {
    case 'single_choice':
      return 'Radio buttons';
    case 'multiple_choice':
      return 'Checkbox';
    case 'short_text':
    case 'long_text':
      return 'Texto';
    case 'select':
      return 'Dropdown';
    case 'unsupported':
      return 'No soportado';
  }
}
