// tests/unit/markdown-renderer.spec.ts
//
// Targeted unit tests for the `renderMetadata` line "Tipo de respuesta:"
// to lock the raw `Question.kind` value (not a localized label).
// The golden files in tests/contracts/ verify the same property
// end-to-end, but a focused unit test makes regressions easier to
// diagnose.

import { describe, it, expect } from 'vitest';
import type { Question } from '~/domain/quiz-schema';
import { renderQuiz } from '~/export/markdown';
import type { QuizDocument } from '~/domain/quiz-schema';

function stubDoc(kind: Question['kind']): QuizDocument {
  const q: Question = {
    number: 1,
    stableFingerprint: 'a'.repeat(64),
    kind,
    promptMarkdown: 'stub prompt',
    choices: [],
    metadata: { stateRaw: 'Sin responder aún' },
    assets: [],
    supportedForAutofill: false,
    warnings: [],
  };
  return {
    schemaVersion: '1.0',
    title: 'Stub quiz',
    source: {
      originHash: 'a'.repeat(64),
      path: '/mod/quiz/attempt.php',
      pageCount: 1,
      exportedAt: '2026-07-16T00:00:00.000Z',
    },
    questions: [q],
    warnings: [],
  };
}

describe('renderMetadata: emits the raw Question.kind value', () => {
  const cases: Array<Question['kind']> = [
    'single_choice',
    'multiple_choice',
    'short_text',
    'long_text',
    'select',
    'unsupported',
  ];

  for (const kind of cases) {
    it(`renders "Tipo de respuesta: ${kind}." for kind="${kind}"`, () => {
      const md = renderQuiz(stubDoc(kind), {
        exportedAt: new Date('2026-07-16T00:00:00Z'),
        generatorVersion: '0.2.0',
      });
      expect(md).toContain(`Tipo de respuesta: ${kind}.`);
    });
  }

  it('does NOT emit the legacy Spanish labels (Radio buttons / Checkbox / Texto / Dropdown / No soportado)', () => {
    for (const kind of cases) {
      const md = renderQuiz(stubDoc(kind), {
        exportedAt: new Date('2026-07-16T00:00:00Z'),
        generatorVersion: '0.2.0',
      });
      expect(md).not.toContain('Radio buttons');
      expect(md).not.toContain('Checkbox');
      expect(md).not.toContain('Dropdown');
      expect(md).not.toContain('No soportado');
    }
  });
});