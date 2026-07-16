// tests/unit/canary-patterns.spec.ts
import { describe, it, expect } from 'vitest';
import {
  CANARY_LABELS,
  REDACTED_PLACEHOLDER,
  findCanaryLeaks,
} from '~/diagnostics/canary-patterns';

describe('canary-patterns (shared with tools/redact-fixture.mjs)', () => {
  it('placeholder contains underscores so it cannot satisfy any canary', () => {
    expect(REDACTED_PLACEHOLDER).toBe('__REDACTED__');
    expect(REDACTED_PLACEHOLDER).toMatch(/^_+$|^[A-Za-z0-9_]*$/);
    expect(findCanaryLeaks(`placeholder ${REDACTED_PLACEHOLDER} safe`)).toEqual([]);
  });

  it('detects attempt=NNN', () => {
    expect(findCanaryLeaks('?attempt=12345')).toHaveLength(1);
    expect(findCanaryLeaks('?attempt=12345')[0]?.label).toBe('attempt=NNN');
  });

  it('detects cmid=NNN', () => {
    expect(findCanaryLeaks('?cmid=42')).toHaveLength(1);
    expect(findCanaryLeaks('?cmid=42')[0]?.label).toBe('cmid=NNN');
  });

  it('detects sesskey=<alnum-only>', () => {
    expect(findCanaryLeaks('sesskey=AbCd1234')).toHaveLength(1);
    expect(findCanaryLeaks('sesskey=AbCd1234')[0]?.label).toBe(
      'sesskey=<alnum-only>',
    );
  });

  it('detects MoodleSession=<alnum-only>', () => {
    expect(findCanaryLeaks('MoodleSession=abc123def456')).toHaveLength(1);
    expect(findCanaryLeaks('MoodleSession=abc123def456')[0]?.label).toBe(
      'MoodleSession=<alnum-only>',
    );
  });

  it('detects input name="qNNN:NNN_*"', () => {
    expect(findCanaryLeaks('name="q12345:6_answer1"')).toHaveLength(1);
    expect(findCanaryLeaks('name="q12345:6_answer1"')[0]?.label).toBe(
      'name="qNNN:NNN_<something>',
    );
  });

  it('detects long hex blobs (≥ 32 hex chars)', () => {
    const hex = 'a'.repeat(32);
    expect(findCanaryLeaks(`value="${hex}"`)[0]?.label).toBe('long-hex-blob');
  });

  it('detects plain email addresses', () => {
    expect(findCanaryLeaks('contact me at user@example.com')[0]?.label).toBe(
      'email',
    );
  });

  it('does NOT flag the placeholder itself (post-redaction fixture format)', () => {
    // After tools/redact-fixture.mjs runs, every secret slot is replaced
    // entirely with __REDACTED__, so the post-redaction form is
    //   name="__REDACTED__"
    // never `name="qNNN:NNN_answer::__REDACTED__"`. The canary correctly
    // matches the latter because `q\d+:\d+_` is a real-Moodle fingerprint.
    const safe = [
      '?attempt=__REDACTED__',
      '?cmid=__REDACTED__',
      'sesskey=__REDACTED__',
      'MoodleSession=__REDACTED__',
      'name="__REDACTED__"',
      'value="__CHECKSUM_REDACTED__"',
      'email=__REDACTED__',
    ].join('\n');
    expect(findCanaryLeaks(safe)).toEqual([]);
  });

  it('CANARY_LABELS exposes one regex per documented category', () => {
    expect(CANARY_LABELS).toHaveLength(7);
  });
});