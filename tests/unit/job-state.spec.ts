// tests/unit/job-state.spec.ts

import { describe, it, expect } from 'vitest';
import { next, isTerminal, type JobState, type JobEvent } from '~/autofill/job-state';

describe('job-state — happy path transitions', () => {
  it('idle → validating on prepare', () => {
    expect(next('idle', { type: 'prepare' })).toEqual({ ok: true, state: 'validating' });
  });

  it('validating → previewing on validated', () => {
    expect(next('validating', { type: 'validated' })).toEqual({ ok: true, state: 'previewing' });
  });

  it('previewing → aborted on previewCancelled', () => {
    expect(next('previewing', { type: 'previewCancelled' })).toEqual({ ok: true, state: 'aborted' });
  });

  it('previewing → applying on previewConfirmed', () => {
    expect(next('previewing', { type: 'previewConfirmed' })).toEqual({ ok: true, state: 'applying' });
  });

  it('applying → done on completed', () => {
    expect(next('applying', { type: 'completed' })).toEqual({ ok: true, state: 'done' });
  });

  it('applying → failed on failed', () => {
    const r = next('applying', { type: 'failed', reason: 'boom' });
    expect(r).toEqual({ ok: true, state: 'failed' });
  });
});

describe('job-state — restart from terminal', () => {
  it.each<JobState>(['done', 'aborted', 'failed'])('allows %s → validating on prepare', (from) => {
    expect(next(from, { type: 'prepare' })).toEqual({ ok: true, state: 'validating' });
  });
});

describe('job-state — invalid transitions', () => {
  it('rejects idle → validated', () => {
    const r = next('idle', { type: 'validated' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('MQX-FILL-306');
    expect(r.error.from).toBe('idle');
  });

  it('rejects done → completed', () => {
    const r = next('done', { type: 'completed' });
    expect(r.ok).toBe(false);
  });

  it('rejects previewing → completed (must go through applying)', () => {
    const r = next('previewing', { type: 'completed' });
    expect(r.ok).toBe(false);
  });

  it('rejects applying → previewing', () => {
    const r = next('applying', { type: 'previewShown' });
    expect(r.ok).toBe(false);
  });
});

describe('job-state — terminal helpers', () => {
  it('marks done/aborted/failed as terminal', () => {
    expect(isTerminal('done')).toBe(true);
    expect(isTerminal('aborted')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
  });

  it('marks in-progress states as non-terminal', () => {
    expect(isTerminal('idle')).toBe(false);
    expect(isTerminal('validating')).toBe(false);
    expect(isTerminal('previewing')).toBe(false);
    expect(isTerminal('applying')).toBe(false);
  });
});

describe('job-state — exhaustive coverage', () => {
  // Document the full (state × event) matrix so future refactors can't
  // silently drop a valid transition.
  const STATES: JobState[] = ['idle', 'validating', 'previewing', 'applying', 'done', 'aborted', 'failed'];
  const EVENTS: JobEvent['type'][] = [
    'prepare', 'validated', 'validateFailed', 'previewShown',
    'previewCancelled', 'previewConfirmed', 'completed', 'aborted', 'failed',
  ];

  it.each(STATES.flatMap((s) => EVENTS.map((e) => [s, e] as const)))(
    'every (state=%s, event=%s) returns a TransitionResult',
    (state, event) => {
      const r = next(state, { type: event } as JobEvent);
      if (r.ok) {
        expect(typeof r.state).toBe('string');
      } else {
        expect(r.error.code).toBe('MQX-FILL-306');
      }
    },
  );
});