// tests/unit/redactor.spec.ts
import { describe, it, expect } from 'vitest';
import {
  MqxPrivLeakError,
  redactObject,
  redactString,
  redactStringSafe,
} from '~/diagnostics/redactor';
import { MQX } from '~/diagnostics/codes';

describe('DiagnosticRedactor', () => {
  describe('redactString (throwing)', () => {
    it('returns the input untouched when no canary matches', () => {
      const safe = 'quiz.md with no secrets';
      expect(redactString(safe)).toBe(safe);
    });

    it('throws MqxPrivLeakError with code MQX-PRIV-401 on a real sesskey', () => {
      expect(() => redactString('?sesskey=abcDEF123')).toThrowError(
        MqxPrivLeakError,
      );
      try {
        redactString('?sesskey=abcDEF123');
      } catch (err) {
        expect(err).toBeInstanceOf(MqxPrivLeakError);
        expect((err as MqxPrivLeakError).code).toBe(MQX.PRIV_LEAK_BLOCKED);
        expect((err as MqxPrivLeakError).leaks).toHaveLength(1);
        expect((err as MqxPrivLeakError).leaks[0]?.label).toBe(
          'sesskey=<alnum-only>',
        );
      }
    });

    it('reports multiple leaks in a single pass', () => {
      expect(() =>
        redactString(
          'attempt=12345&cmid=67890&name="q1:2_choice1"&x=hello@example.com',
        ),
      ).toThrowError(MqxPrivLeakError);
    });

    it('does NOT throw when placeholders are present', () => {
      const ok = '?attempt=__REDACTED__&sesskey=__REDACTED__';
      expect(redactString(ok)).toBe(ok);
    });

    it('handles empty string', () => {
      expect(redactString('')).toBe('');
    });

    it('handles unicode strings', () => {
      const unicode = 'Cuestionario DSOP — Unidad 1 — Evaluación diagnóstica';
      expect(redactString(unicode)).toBe(unicode);
    });
  });

  describe('redactStringSafe (non-throwing)', () => {
    it('returns ok=true on clean input', () => {
      const r = redactStringSafe('quiz.md');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe('quiz.md');
    });

    it('returns ok=false with leak metadata on dirty input', () => {
      const r = redactStringSafe('?sesskey=AbCdEf12345');
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.leaks.length).toBeGreaterThanOrEqual(1);
        expect(r.leaks[0]?.label).toBe('sesskey=<alnum-only>');
      }
    });
  });

  describe('redactObject', () => {
    it('passes through clean strings untouched', () => {
      const out = redactObject({
        title: 'Quiz DSOP',
        note: 'safe note',
      });
      expect(out.title).toBe('Quiz DSOP');
      expect(out.note).toBe('safe note');
    });

    it('throws when any string value contains a canary match', () => {
      expect(() =>
        redactObject({ title: 'Quiz DSOP', note: '?sesskey=abcDEF123' }),
      ).toThrowError(MqxPrivLeakError);
    });

    it('passes through nested objects (only shallow scan)', () => {
      const obj = {
        meta: { inner: '?sesskey=leak' },
      };
      expect(() => redactObject(obj)).not.toThrow();
      // Documented shallow behavior: the nested leak is missed. Callers that
      // need a deep scan should walk the tree themselves.
      expect((obj.meta as { inner: string }).inner).toBe('?sesskey=leak');
    });
  });

  describe('MqxPrivLeakError', () => {
    it('carries the MQX-PRIV-401 code', () => {
      const err = new MqxPrivLeakError([
        { label: 'cmid=NNN', match: 'cmid=1' },
      ]);
      expect(err.code).toBe('MQX-PRIV-401');
      expect(err.name).toBe('MqxPrivLeakError');
      expect(err.message).toContain('cmid=NNN');
    });
  });
});