// src/autofill/job-state.ts
//
// Pure state machine for the autofill job. No DOM, no browser, no clock.
// Callers inject time when they need TTL semantics (JobStore wraps this
// with `storage.session` and a heartbeat).
//
// States:
//   idle        → no job in progress
//   validating  → parsing + fingerprint check
//   previewing  → DOM shadow modal shown, awaiting user confirmation
//   applying    → controls being mutated (NoSubmitSpy engaged)
//   done        → all steps confirmed; user must submit by hand
//   aborted     → user cancelled or popup closed
//   failed      → unrecoverable error; job frozen until restart
//
// The machine is total: every (state, event) pair returns either a new
// state or a typed `TransitionError`. It is the caller's responsibility
// to surface the error and not retry blindly.

export type JobState =
  | 'idle'
  | 'validating'
  | 'previewing'
  | 'applying'
  | 'done'
  | 'aborted'
  | 'failed';

export type JobEvent =
  | { type: 'prepare' }
  | { type: 'validated' }
  | { type: 'validateFailed' }
  | { type: 'previewShown' }
  | { type: 'previewCancelled' }
  | { type: 'previewConfirmed' }
  | { type: 'completed' }
  | { type: 'aborted' }
  | { type: 'failed'; reason: string };

export interface TransitionError {
  readonly code: 'MQX-FILL-306';
  readonly message: string;
  readonly from: JobState;
  readonly event: JobEvent['type'];
}

export type TransitionResult =
  | { ok: true; state: JobState }
  | { ok: false; error: TransitionError };

export function next(state: JobState, event: JobEvent): TransitionResult {
  const key = `${state}:${event.type}` as const;
  const result = TRANSITIONS[key];
  if (!result) {
    return {
      ok: false,
      error: {
        code: 'MQX-FILL-306',
        message: `transición inválida: ${state} → ${event.type}`,
        from: state,
        event: event.type,
      },
    };
  }
  return { ok: true, state: result };
}

const TRANSITIONS: Record<string, JobState> = {
  // From idle
  'idle:prepare': 'validating',
  // From validating
  'validating:validated': 'previewing',
  'validating:validateFailed': 'failed',
  'validating:aborted': 'aborted',
  // From previewing
  'previewing:previewShown': 'previewing', // idempotent: re-render modal
  'previewing:previewCancelled': 'aborted',
  'previewing:previewConfirmed': 'applying',
  'previewing:aborted': 'aborted',
  'previewing:failed': 'failed',
  // From applying
  'applying:completed': 'done',
  'applying:failed': 'failed',
  'applying:aborted': 'aborted',
  // From done / aborted / failed: only restart is allowed
  'done:prepare': 'validating',
  'aborted:prepare': 'validating',
  'failed:prepare': 'validating',
};

export const TERMINAL_STATES: ReadonlySet<JobState> = new Set(['done', 'aborted', 'failed']);

export function isTerminal(state: JobState): boolean {
  return TERMINAL_STATES.has(state);
}