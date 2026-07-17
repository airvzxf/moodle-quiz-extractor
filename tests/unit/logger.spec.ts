// tests/unit/logger.spec.ts
//
// Behavior of the \`RingBufferLogger\`: capacity, eviction, snapshot order,
// dropped count, and clear().

import { describe, it, expect } from 'vitest';
import { RingBufferLogger } from '~/diagnostics/logger';
import { MQX } from '~/diagnostics/codes';
import type {
  DiagnosticsCode,
  StoredDiagnosticsEvent,
  DiagnosticsStage,
} from '~/diagnostics/diagnostics-types';

function ev(
  stage: DiagnosticsStage,
  code: DiagnosticsCode,
  n = 0,
): StoredDiagnosticsEvent {
  return n > 0 ? { ts: n, stage, code, questionNumber: n } : { ts: n, stage, code };
}

describe('RingBufferLogger', () => {
  it('rejects non-positive capacity', () => {
    expect(() => new RingBufferLogger({ capacity: 0 })).toThrow();
    expect(() => new RingBufferLogger({ capacity: -1 })).toThrow();
  });

  it('returns an empty snapshot on a fresh logger', () => {
    const r = RingBufferLogger.empty(50);
    expect(r.length()).toBe(0);
    expect(r.dropped()).toBe(0);
    expect(r.snapshot()).toEqual([]);
  });

  it('appends events in chronological order before wrap-around', () => {
    const r = new RingBufferLogger({ capacity: 3 });
    r.append(ev('parse', MQX.PARSE_UNKNOWN, 1));
    r.append(ev('parse', MQX.PARSE_NOT_IMPLEMENTED, 2));
    expect(r.length()).toBe(2);
    expect(r.dropped()).toBe(0);
    expect(r.snapshot().map((e) => e.ts)).toEqual([1, 2]);
  });

  it('overwrites oldest entries after wrap-around and increments dropped', () => {
    const r = new RingBufferLogger({ capacity: 3 });
    for (let i = 1; i <= 5; i += 1) r.append(ev('fill', MQX.FILL_LETTER_NOT_FOUND, i));
    expect(r.length()).toBe(3);
    expect(r.dropped()).toBe(2);
    const snap = r.snapshot();
    // Last three ts: 3, 4, 5
    expect(snap.map((e) => e.ts)).toEqual([3, 4, 5]);
  });

  it('appendInput() validates ts and stamps stage/code/questionNumber', () => {
    const r = new RingBufferLogger({ capacity: 10 });
    const out = r.appendInput(
      { schemaVersion: '1.0', stage: 'fill', code: MQX.FILL_LETTER_NOT_FOUND, questionNumber: 7 },
      1234,
    );
    expect(out.appended).toBe(true);
    expect(out.event?.questionNumber).toBe(7);
    expect(r.snapshot()[0]?.ts).toBe(1234);
    expect(() =>
      r.appendInput(
        { schemaVersion: '1.0', stage: 'fill', code: MQX.FILL_LETTER_NOT_FOUND },
        -1,
      ),
    ).toThrow();
    expect(() =>
      r.appendInput(
        { schemaVersion: '1.0', stage: 'fill', code: MQX.FILL_LETTER_NOT_FOUND },
        Number.NaN,
      ),
    ).toThrow();
  });

  it('clear() resets ring, count, and dropped counter', () => {
    const r = new RingBufferLogger({ capacity: 2 });
    r.append(ev('parse', MQX.PARSE_UNKNOWN, 1));
    r.append(ev('parse', MQX.PARSE_NOT_IMPLEMENTED, 2));
    r.append(ev('parse', MQX.PARSE_INVALID_LETTER, 3));
    expect(r.length()).toBe(2);
    expect(r.dropped()).toBe(1);
    r.clear();
    expect(r.length()).toBe(0);
    expect(r.dropped()).toBe(0);
    expect(r.snapshot()).toEqual([]);
  });

  it('snapshot() returns a defensive copy', () => {
    const r = new RingBufferLogger({ capacity: 3 });
    r.append(ev('asset', MQX.ASSET_MIME_DENIED, 1));
    const s = r.snapshot();
    expect(s.length).toBe(1);
    // Mutating the returned array must not mutate the ring.
    (s as StoredDiagnosticsEvent[]).pop();
    expect(r.length()).toBe(1);
  });
});