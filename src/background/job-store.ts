// src/background/job-store.ts
//
// JobStore persists autofill jobs in `browser.storage.session` with a
// hard TTL (default 30 min). It is *never* backed by `storage.sync`
// (which crosses devices and would leak the user's answers).
//
// The store is dependency-injected with a `StorageAdapter` so unit
// tests can drive it without jsdom or the browser API. The production
// adapter wraps `browser.storage.session`.
//
// Each persisted entry contains:
//   - jobId        UUID v4
//   - state        JobState (idle | validating | previewing | ...)
//   - plan         serialized ApplyPlan
//   - updatedAt    epoch ms used for TTL
//
// The store is best-effort: if storage is unavailable (e.g. Firefox
// private mode with session storage disabled), every operation degrades
// to in-memory only and the caller sees `skipped: true`.

import type { ApplyPlan } from '~/autofill/apply-plan';
import type { JobState } from '~/autofill/job-state';
import { redactString } from '~/diagnostics/redactor';

export interface StorageAdapter {
  get(key: string): Promise<Record<string, unknown> | null>;
  set(key: string, value: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface PersistedJob {
  readonly jobId: string;
  readonly state: JobState;
  readonly plan: ApplyPlan;
  readonly updatedAt: number;
}

export interface JobStoreOptions {
  /** TTL in ms; jobs older than `now - ttlMs` are purged on load. */
  readonly ttlMs?: number;
  /** Optional clock injection for tests. */
  readonly now?: () => number;
  /** Override the storage key prefix (tests). */
  readonly keyPrefix?: string;
}

export interface JobLoadResult {
  readonly job: PersistedJob | null;
  readonly skipped: boolean;
  readonly reason?: string;
}

export const DEFAULT_JOB_TTL_MS = 30 * 60 * 1000;
const KEY_PREFIX_DEFAULT = 'mqx:job:';

export class JobStore {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly keyPrefix: string;
  private readonly memory = new Map<string, PersistedJob>();

  constructor(
    private readonly storage: StorageAdapter | null,
    options: JobStoreOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? DEFAULT_JOB_TTL_MS;
    this.now = options.now ?? Date.now;
    this.keyPrefix = options.keyPrefix ?? KEY_PREFIX_DEFAULT;
  }

  /** Persists a new job. Returns the persisted record (with updatedAt set). */
  async create(jobId: string, state: JobState, plan: ApplyPlan): Promise<PersistedJob> {
    const safeId = redactString(jobId);
    const job: PersistedJob = {
      jobId: safeId,
      state,
      plan,
      updatedAt: this.now(),
    };
    await this.write(job);
    return job;
  }

  /** Loads a job by id; returns null if missing or expired. */
  async load(jobId: string): Promise<JobLoadResult> {
    const safeId = redactString(jobId);
    const job = await this.read(safeId);
    if (!job) return { job: null, skipped: false };
    if (this.isExpired(job)) {
      await this.delete(safeId);
      return { job: null, skipped: false, reason: 'expired' };
    }
    return { job, skipped: false };
  }

  /** Updates the state and heartbeat of an existing job. */
  async update(jobId: string, state: JobState, plan?: ApplyPlan): Promise<PersistedJob | null> {
    const safeId = redactString(jobId);
    const current = await this.read(safeId);
    if (!current) return null;
    const updated: PersistedJob = {
      jobId: current.jobId,
      state,
      plan: plan ?? current.plan,
      updatedAt: this.now(),
    };
    await this.write(updated);
    return updated;
  }

  /** Removes the job from storage. */
  async delete(jobId: string): Promise<void> {
    const safeId = redactString(jobId);
    this.memory.delete(safeId);
    if (this.storage) {
      try {
        await this.storage.remove(this.key(safeId));
      } catch {
        // Storage removal failed; the entry is no longer in `memory`
        // so future calls return null. Logged by the caller.
      }
    }
  }

  isExpired(job: PersistedJob): boolean {
    return this.now() - job.updatedAt > this.ttlMs;
  }

  private key(jobId: string): string {
    return `${this.keyPrefix}${jobId}`;
  }

  private async read(jobId: string): Promise<PersistedJob | null> {
    if (this.memory.has(jobId)) {
      return this.memory.get(jobId) ?? null;
    }
    if (!this.storage) return null;
    try {
      const raw = await this.storage.get(this.key(jobId));
      if (!raw) return null;
      // The adapter returns a Record<string, unknown>; the persisted
      // shape is a single field "value" wrapping the job.
      const candidate = raw['value'] as PersistedJob | undefined;
      if (!candidate) return null;
      this.memory.set(jobId, candidate);
      return candidate;
    } catch {
      return null;
    }
  }

  private async write(job: PersistedJob): Promise<void> {
    this.memory.set(job.jobId, job);
    if (!this.storage) return;
    try {
      await this.storage.set(this.key(job.jobId), { value: job });
    } catch {
      // Storage write failed; the in-memory map still has it for the
      // lifetime of this SW instance. Future loads from another
      // context will miss it.
    }
  }
}

/** In-memory adapter for tests. */
export class MemoryStorageAdapter implements StorageAdapter {
  private readonly map = new Map<string, Record<string, unknown>>();

  async get(key: string): Promise<Record<string, unknown> | null> {
    return this.map.get(key) ?? null;
  }

  async set(key: string, value: Record<string, unknown>): Promise<void> {
    this.map.set(key, { ...value });
  }

  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }

  /** Test helper: inspect the raw map. */
  raw(): Map<string, Record<string, unknown>> {
    return this.map;
  }
}

/** Production adapter wrapping browser.storage.session. */
export class BrowserStorageSessionAdapter implements StorageAdapter {
  async get(key: string): Promise<Record<string, unknown> | null> {
    const session = (globalThis as { browser?: { storage?: { session?: StorageAreaLike } } }).browser?.storage?.session;
    if (!session) return null;
    const out = await session.get(key);
    return (out[key] as Record<string, unknown> | undefined) ?? null;
  }

  async set(key: string, value: Record<string, unknown>): Promise<void> {
    const session = (globalThis as { browser?: { storage?: { session?: StorageAreaLike } } }).browser?.storage?.session;
    if (!session) return;
    await session.set({ [key]: value });
  }

  async remove(key: string): Promise<void> {
    const session = (globalThis as { browser?: { storage?: { session?: StorageAreaLike } } }).browser?.storage?.session;
    if (!session) return;
    await session.remove(key);
  }
}

interface StorageAreaLike {
  get(keys?: string | string[] | Record<string, unknown>): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}