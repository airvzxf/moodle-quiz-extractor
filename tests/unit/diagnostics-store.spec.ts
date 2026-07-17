// tests/unit/diagnostics-store.spec.ts
//
// Per-tab diagnostics store. Verifies:
//   - Round-trip append -> snapshot survives via storage adapter.
//   - TTL purges expired entries.
//   - Concurrent appends do not lose events.
//   - Tab deletion wipes in-memory + storage copies.

import { describe, it, expect, beforeEach } from 'vitest';
import { DiagnosticsStore } from '~/background/diagnostics-store';
import { MemoryStorageAdapter } from '~/background/job-store';
import { MQX } from '~/diagnostics/codes';
import { DIAGNOSTICS_TTL_MS } from '~/diagnostics/diagnostics-types';

describe('DiagnosticsStore', () => {
  let storage: MemoryStorageAdapter;
  let store: DiagnosticsStore;
  let now = 0;

  beforeEach(() => {
    storage = new MemoryStorageAdapter();
    now = 1_700_000_000_000;
    store = new DiagnosticsStore(storage, {
      now: () => now,
    });
  });

  it('appends events and reads the snapshot back', async () => {
    await store.append(
      7,
      { schemaVersion: '1.0', stage: 'parse', code: MQX.PARSE_UNKNOWN },
      now,
    );
    await store.append(
      7,
      { schemaVersion: '1.0', stage: 'fill', code: MQX.FILL_LETTER_NOT_FOUND, questionNumber: 3 },
      now + 1,
    );
    const events = await store.snapshot(7);
    expect(events.length).toBe(2);
    expect(events[0]?.stage).toBe('parse');
    expect(events[1]?.questionNumber).toBe(3);
  });

  it('persists the snapshot to storage.session', async () => {
    await store.append(
      1,
      { schemaVersion: '1.0', stage: 'parse', code: MQX.PARSE_UNKNOWN },
      now,
    );
    const raw = storage.raw().get('mqx:diag:1');
    expect(raw).toBeTruthy();
    const persisted = (raw as { value: { events: Array<{ code: string }> } }).value;
    expect(persisted.events[0]?.code).toBe(MQX.PARSE_UNKNOWN);
  });

  it('drops expired entries on load', async () => {
    await store.append(
      1,
      { schemaVersion: '1.0', stage: 'parse', code: MQX.PARSE_UNKNOWN },
      now,
    );
    // Advance past the TTL and reload via a fresh store.
    now += DIAGNOSTICS_TTL_MS + 1;
    const fresh = new DiagnosticsStore(storage, { now: () => now });
    const events = await fresh.snapshot(1);
    expect(events.length).toBe(0);
  });

  it('serializes concurrent appends per tab', async () => {
    const inputs = Array.from({ length: 50 }, (_, i) => ({
      schemaVersion: '1.0' as const,
      stage: 'parse' as const,
      code: MQX.PARSE_UNKNOWN,
      questionNumber: i + 1,
    }));
    await Promise.all(inputs.map((ev) => store.append(1, ev, now + ev.questionNumber!)));
    const events = await store.snapshot(1);
    expect(events.length).toBe(50);
  });

  it('clear() resets in-memory and storage copies', async () => {
    await store.append(
      1,
      { schemaVersion: '1.0', stage: 'parse', code: MQX.PARSE_UNKNOWN },
      now,
    );
    await store.clear(1);
    const events = await store.snapshot(1);
    expect(events.length).toBe(0);
    expect(storage.raw().has('mqx:diag:1')).toBe(false);
  });

  it('delete() drops the slot and the storage entry', async () => {
    await store.append(
      1,
      { schemaVersion: '1.0', stage: 'parse', code: MQX.PARSE_UNKNOWN },
      now,
    );
    await store.delete(1);
    expect(storage.raw().has('mqx:diag:1')).toBe(false);
    const events = await store.snapshot(1);
    expect(events.length).toBe(0);
  });

  it('two tabs are independent', async () => {
    await store.append(
      1,
      { schemaVersion: '1.0', stage: 'parse', code: MQX.PARSE_UNKNOWN },
      now,
    );
    await store.append(
      2,
      { schemaVersion: '1.0', stage: 'fill', code: MQX.FILL_LETTER_NOT_FOUND },
      now + 1,
    );
    expect((await store.snapshot(1)).length).toBe(1);
    expect((await store.snapshot(2)).length).toBe(1);
  });
});