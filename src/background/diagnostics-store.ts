// src/background/diagnostics-store.ts
//
// Per-tab diagnostics ring buffer, persisted to \`browser.storage.session\`
// (TTL 30 min). One ring per active tab; cleared when the tab closes.
//
// Concurrency: \`append\` and \`clear\` are serialized per tabId with a
// promise chain. The ring itself is mutated synchronously (the only
// place where state lives) but the storage.session write happens
// afterwards without blocking the caller. \`load\` reads from the
// in-memory copy first (fast path) and falls back to storage.session.
//
// The store owns the ring (\`RingBufferLogger\`); callers ask for the
// current ring and either \`append\` events or call \`clear()\`. The ring
// snapshot is what \`buildSafeReport\` consumes.

import {
  DIAGNOSTICS_TTL_MS,
  type DiagnosticsEventInput,
  type StoredDiagnosticsEvent,
} from '~/diagnostics/diagnostics-types';
import { RingBufferLogger } from '~/diagnostics/logger';
import {
  type StorageAdapter,
} from '~/background/job-store';

const KEY_PREFIX = 'mqx:diag:';

export interface PersistedDiagnostics {
  readonly tabId: number;
  readonly updatedAt: number;
  readonly events: ReadonlyArray<StoredDiagnosticsEvent>;
  readonly dropped: number;
}

export interface DiagnosticsStoreOptions {
  readonly ttlMs?: number;
  readonly now?: () => number;
  readonly capacity?: number;
  readonly keyPrefix?: string;
}

interface TabSlot {
  ring: RingBufferLogger;
  updatedAt: number;
  chain: Promise<void>;
}

export class DiagnosticsStore {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly keyPrefix: string;
  private readonly tabs = new Map<number, TabSlot>();

  constructor(
    private readonly storage: StorageAdapter | null,
    options: DiagnosticsStoreOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? DIAGNOSTICS_TTL_MS;
    this.now = options.now ?? Date.now;
    this.keyPrefix = options.keyPrefix ?? KEY_PREFIX;
  }

  /** Returns the in-memory ring for a tab, restoring it from storage if
   *  necessary. Returns \`null\` when the stored entry is expired or
   *  corrupted. */
  async load(tabId: number): Promise<RingBufferLogger | null> {
    const existing = this.tabs.get(tabId);
    if (existing) return existing.ring;
    if (!this.storage) return null;
    try {
      const raw = await this.storage.get(this.key(tabId));
      const candidate = raw?.['value'] as PersistedDiagnostics | undefined;
      if (!candidate) return null;
      if (this.isExpired(candidate.updatedAt)) {
        await this.delete(tabId);
        return null;
      }
      const ring = this.rebuildRing(candidate);
      this.tabs.set(tabId, {
        ring,
        updatedAt: candidate.updatedAt,
        chain: Promise.resolve(),
      });
      return ring;
    } catch {
      return null;
    }
  }

  /** Append an input event into the ring for \`tabId\`. The \`ts\` is
   *  stamped by the caller (the background SW clock). */
  async append(tabId: number, input: DiagnosticsEventInput, ts: number): Promise<void> {
    const slot = await this.ensureSlot(tabId);
    slot.ring.appendInput(input, ts);
    slot.updatedAt = this.now();
    await this.persist(slot, tabId);
  }

  /** Clear the ring for \`tabId\`. Idempotent. Removes the storage
   *  entry entirely so the next \`snapshot\` is empty even after a
   *  restart of the SW. */
  async clear(tabId: number): Promise<void> {
    const existing = this.tabs.get(tabId);
    if (existing) {
      existing.ring.clear();
      existing.updatedAt = this.now();
      // Drop the in-memory slot AND the storage entry so future
      // loads do not see a half-empty ring.
      this.tabs.delete(tabId);
      if (this.storage) {
        try {
          await existing.chain;
          await this.storage.remove(this.key(tabId));
        } catch {
          // Best-effort.
        }
      }
      return;
    }
    if (this.storage) {
      try {
        await this.storage.remove(this.key(tabId));
      } catch {
        // Best-effort.
      }
    }
  }

  /** Drop the ring entirely from memory + storage. Used when a tab
   *  closes. */
  async delete(tabId: number): Promise<void> {
    const existing = this.tabs.get(tabId);
    this.tabs.delete(tabId);
    if (existing) {
      try {
        await existing.chain;
      } catch {
        // Best-effort.
      }
    }
    if (!this.storage) return;
    try {
      await this.storage.remove(this.key(tabId));
    } catch {
      // Best-effort.
    }
  }

  /** Snapshot the current ring (or empty ring if absent). */
  async snapshot(tabId: number): Promise<ReadonlyArray<StoredDiagnosticsEvent>> {
    const ring = await this.load(tabId);
    return ring ? ring.snapshot() : [];
  }

  isExpired(updatedAt: number): boolean {
    return this.now() - updatedAt > this.ttlMs;
  }

  private key(tabId: number): string {
    return `${this.keyPrefix}${tabId}`;
  }

  private async ensureSlot(tabId: number): Promise<TabSlot> {
    const existing = this.tabs.get(tabId);
    if (existing) return existing;
    const previous = await this.load(tabId);
    const ring = previous ?? RingBufferLogger.empty();
    const slot: TabSlot = {
      ring,
      updatedAt: this.now(),
      chain: Promise.resolve(),
    };
    // Re-check: a concurrent caller may have created the slot while
    // we were awaiting the storage load.
    const winner = this.tabs.get(tabId) ?? slot;
    this.tabs.set(tabId, winner);
    return winner;
  }

  private async persist(slot: TabSlot, tabId: number): Promise<void> {
    // Serialize all writes for this tab so two concurrent appends do
    // not race on the underlying storage.
    const next = slot.chain.then(() => this.writeSlot(slot, tabId));
    slot.chain = next.catch(() => undefined);
    await next;
  }

  private async writeSlot(slot: TabSlot, tabId: number): Promise<void> {
    if (!this.storage) return;
    try {
      const payload: PersistedDiagnostics = {
        tabId,
        updatedAt: slot.updatedAt,
        events: slot.ring.snapshot(),
        dropped: slot.ring.dropped(),
      };
      await this.storage.set(this.key(tabId), { value: payload });
    } catch {
      // Storage write failed; the in-memory ring still has the events
      // for the lifetime of this SW.
    }
  }

  private rebuildRing(snapshot: PersistedDiagnostics): RingBufferLogger {
    const ring = RingBufferLogger.empty();
    for (const ev of snapshot.events) {
      ring.append(ev);
    }
    return ring;
  }
}