// src/diagnostics/logger.ts
//
// \`RingBufferLogger\` — fixed-size FIFO ring of \`StoredDiagnosticsEvent\`.
// Pure TypeScript: no DOM, no fetch, no storage. The background SW
// owns one ring per tab; the content script only sends raw inputs.
//
// Design notes:
//   - Capacity is fixed at construction time. \`snapshot()\` returns the
//     logical chronological view (oldest -> newest) after wrap-around.
//   - \`dropped()\` counts how many events were rejected by overflow.
//     We do NOT silently overwrite: callers see \`dropped\` in the safe
//     report and can decide whether to enlarge the ring (Fase 5).
//   - \`append()\` is synchronous. The background wraps the whole
//     append+persist sequence in a per-tab queue (see
//     \`DiagnosticsStore\`) to make storage.session writes serial.
//   - The ring never holds user-provided strings. Only \`StoredDiagnosticsEvent\`,
//     which contains enums and numbers — verified by Zod before storage.

import type {
  StoredDiagnosticsEvent,
  DiagnosticsEventInput,
  DiagnosticsStage,
  DiagnosticsCode,
} from '~/diagnostics/diagnostics-types';
import { DIAGNOSTICS_RING_CAPACITY } from '~/diagnostics/diagnostics-types';

export interface RingBufferLoggerOptions {
  readonly capacity?: number;
  readonly now?: () => number;
}

export class RingBufferLogger {
  private readonly capacity: number;
  private readonly now: () => number;
  private readonly buf: Array<StoredDiagnosticsEvent | undefined>;
  private head = 0;
  private count = 0;
  private droppedCount = 0;

  constructor(options: RingBufferLoggerOptions = {}) {
    this.capacity = options.capacity ?? DIAGNOSTICS_RING_CAPACITY;
    if (this.capacity <= 0) {
      throw new Error('RingBufferLogger capacity must be positive');
    }
    this.now = options.now ?? Date.now;
    this.buf = new Array(this.capacity).fill(undefined);
  }

  /** Append a fully-stamped event. Returns false when the ring was full
   *  (the event is dropped and \`dropped()\` is incremented). */
  append(event: StoredDiagnosticsEvent): boolean {
    const slot = this.buf[this.head];
    if (slot !== undefined) {
      this.droppedCount += 1;
    }
    this.buf[this.head] = event;
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
    return true;
  }

  /** Build a stamped event from an input + background-supplied metadata
   *  and append it. The two helpers are split to keep \`append\` pure. */
  appendInput(
    input: DiagnosticsEventInput,
    ts: number,
  ): { appended: boolean; event?: StoredDiagnosticsEvent } {
    if (!Number.isFinite(ts) || ts < 0) {
      throw new Error('ts must be a non-negative finite number');
    }
    const event: StoredDiagnosticsEvent = {
      ts,
      stage: input.stage,
      code: input.code,
      ...(input.questionNumber !== undefined
        ? { questionNumber: input.questionNumber }
        : {}),
    };
    const appended = this.append(event);
    return appended ? { appended: true, event } : { appended: false };
  }

  /** Chronological snapshot (oldest -> newest). The returned array is a
   *  defensive copy so the caller can sort/filter without mutating the
   *  ring. */
  snapshot(): ReadonlyArray<StoredDiagnosticsEvent> {
    const out: StoredDiagnosticsEvent[] = [];
    if (this.count === 0) return out;
    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i += 1) {
      const slot = this.buf[(start + i) % this.capacity];
      if (slot !== undefined) out.push(slot);
    }
    return out;
  }

  /** Reset the ring. Used by background on tab close / clear-cache. */
  clear(): void {
    this.buf.fill(undefined);
    this.head = 0;
    this.count = 0;
    this.droppedCount = 0;
  }

  capacity_size(): number {
    return this.capacity;
  }

  length(): number {
    return this.count;
  }

  dropped(): number {
    return this.droppedCount;
  }

  now_fn(): number {
    return this.now();
  }

  static empty(capacity?: number): RingBufferLogger {
    return new RingBufferLogger({ capacity });
  }
}

export type { DiagnosticsStage, DiagnosticsCode };