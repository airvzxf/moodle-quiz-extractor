// tests/unit/job-store.spec.ts

import { describe, it, expect } from 'vitest';
import { JobStore, MemoryStorageAdapter, type PersistedJob } from '~/background/job-store';
import type { ApplyPlan } from '~/autofill/apply-plan';

function makePlan(): ApplyPlan {
  return {
    schemaVersion: '1.0',
    steps: [
      {
        questionFingerprint: 'a'.repeat(64),
        questionNumber: 1,
        kind: 'radio',
        value: ['a'],
        sourceLine: 1,
      },
    ],
    warnings: [],
  };
}

function makeAdapter(): MemoryStorageAdapter {
  return new MemoryStorageAdapter();
}

describe('JobStore — create / load / update / delete', () => {
  it('create then load round-trips a job through the adapter', async () => {
    const adapter = makeAdapter();
    const store = new JobStore(adapter);
    const plan = makePlan();
    const created = await store.create('job-1', 'validating', plan);
    expect(created.jobId).toBe('job-1');
    expect(created.state).toBe('validating');
    const loaded = await store.load('job-1');
    expect(loaded.job?.plan).toEqual(plan);
    expect(loaded.job?.state).toBe('validating');
  });

  it('update changes state and bumps updatedAt', async () => {
    const adapter = makeAdapter();
    let clock = 1000;
    const store = new JobStore(adapter, { now: () => clock });
    await store.create('job-1', 'validating', makePlan());
    clock = 2000;
    const updated = await store.update('job-1', 'previewing');
    expect(updated?.state).toBe('previewing');
    expect(updated?.updatedAt).toBe(2000);
    const loaded = await store.load('job-1');
    expect(loaded.job?.state).toBe('previewing');
    expect(loaded.job?.updatedAt).toBe(2000);
  });

  it('update with a new plan replaces the plan', async () => {
    const adapter = makeAdapter();
    const store = new JobStore(adapter);
    await store.create('job-1', 'validating', makePlan());
    const newPlan: ApplyPlan = {
      schemaVersion: '1.0',
      steps: [],
      warnings: [],
    };
    const updated = await store.update('job-1', 'previewing', newPlan);
    expect(updated?.plan.steps).toEqual([]);
  });

  it('delete removes the job from the adapter', async () => {
    const adapter = makeAdapter();
    const store = new JobStore(adapter);
    await store.create('job-1', 'validating', makePlan());
    await store.delete('job-1');
    expect(adapter.raw().size).toBe(0);
    const loaded = await store.load('job-1');
    expect(loaded.job).toBeNull();
  });

  it('load returns null for an unknown job', async () => {
    const store = new JobStore(makeAdapter());
    const loaded = await store.load('nope');
    expect(loaded.job).toBeNull();
  });
});

describe('JobStore — TTL handling', () => {
  it('loads the job if it is fresh', async () => {
    let clock = 1000;
    const store = new JobStore(makeAdapter(), { now: () => clock, ttlMs: 30 * 60 * 1000 });
    await store.create('job-1', 'validating', makePlan());
    clock = 1000 + 29 * 60 * 1000; // 29 min later
    const loaded = await store.load('job-1');
    expect(loaded.job?.state).toBe('validating');
  });

  it('purges the job when older than the TTL and reports expired', async () => {
    let clock = 1000;
    const store = new JobStore(makeAdapter(), { now: () => clock, ttlMs: 1000 });
    await store.create('job-1', 'validating', makePlan());
    clock = 5000;
    const loaded = await store.load('job-1');
    expect(loaded.job).toBeNull();
    expect(loaded.reason).toBe('expired');
  });
});

describe('JobStore — storage fallback', () => {
  it('falls back to in-memory only when storage is null', async () => {
    const store = new JobStore(null);
    await store.create('job-1', 'validating', makePlan());
    const loaded = await store.load('job-1');
    expect(loaded.job?.state).toBe('validating');
  });

  it('survives storage throws on set', async () => {
    const adapter: MemoryStorageAdapter & { set: (k: string, v: Record<string, unknown>) => Promise<void> } = new MemoryStorageAdapter();
    adapter.set = async () => {
      throw new Error('quota exceeded');
    };
    const store = new JobStore(adapter);
    await store.create('job-1', 'validating', makePlan());
    const loaded = await store.load('job-1');
    expect(loaded.job?.state).toBe('validating');
  });
});

describe('JobStore — key isolation', () => {
  it('uses a per-job key under the configured prefix', async () => {
    const adapter = makeAdapter();
    const store = new JobStore(adapter, { keyPrefix: 'test:' });
    await store.create('job-1', 'validating', makePlan());
    expect(adapter.raw().has('test:job-1')).toBe(true);
  });

  it('redacts canary patterns in the jobId', async () => {
    const adapter = makeAdapter();
    const store = new JobStore(adapter);
    await expect(store.create('sesskey=leaked123', 'validating', makePlan())).rejects.toThrow();
  });
});

describe('JobStore — isExpired', () => {
  it('returns true when the job is older than ttlMs', () => {
    let clock = 0;
    const store = new JobStore(makeAdapter(), { now: () => clock, ttlMs: 1000 });
    const job: PersistedJob = {
      jobId: 'job-1',
      state: 'idle',
      plan: makePlan(),
      updatedAt: 0,
    };
    clock = 5000;
    expect(store.isExpired(job)).toBe(true);
  });

  it('returns false when the job is within ttlMs', () => {
    let clock = 0;
    const store = new JobStore(makeAdapter(), { now: () => clock, ttlMs: 1000 });
    const job: PersistedJob = {
      jobId: 'job-1',
      state: 'idle',
      plan: makePlan(),
      updatedAt: 0,
    };
    clock = 500;
    expect(store.isExpired(job)).toBe(false);
  });
});