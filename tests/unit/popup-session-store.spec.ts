// tests/unit/popup-session-store.spec.ts

import { describe, it, expect } from 'vitest';
import {
  MemoryStorageAdapter,
  PopupSessionStore,
  POPUP_SESSION_SCHEMA_VERSION,
  type PopupSessionState,
} from '~/background/popup-session-store';

const ORIGIN_A = 'a'.repeat(64);
const ORIGIN_B = 'b'.repeat(64);

function makeState(overrides: Partial<PopupSessionState> = {}): PopupSessionState {
  return {
    schemaVersion: POPUP_SESSION_SCHEMA_VERSION,
    originHash: ORIGIN_A,
    savedAt: Date.now(),
    answersText: '1. a)\n2. b)',
    lastDocumentJson: JSON.stringify({ schemaVersion: '1.0', questions: [] }),
    lastJobId: null,
    hasAutofillContext: false,
    ...overrides,
  };
}

describe('PopupSessionStore — save / load / delete', () => {
  it('save then load round-trips state through the adapter', async () => {
    const adapter = new MemoryStorageAdapter();
    const store = new PopupSessionStore(adapter);
    const state = makeState();
    await store.save(101, state);
    const r = await store.load(101, ORIGIN_A);
    expect(r.state).not.toBeNull();
    if (!r.state) return;
    expect(r.state.answersText).toBe('1. a)\n2. b)');
    expect(r.state.lastDocumentJson).toBe(state.lastDocumentJson);
    expect(r.state.hasAutofillContext).toBe(false);
  });

  it('keys are tab-scoped: same origin, different tabs do not collide', async () => {
    const adapter = new MemoryStorageAdapter();
    const store = new PopupSessionStore(adapter);
    await store.save(101, makeState({ answersText: 'tab 101' }));
    await store.save(202, makeState({ answersText: 'tab 202' }));
    const a = await store.load(101, ORIGIN_A);
    const b = await store.load(202, ORIGIN_A);
    expect(a.state?.answersText).toBe('tab 101');
    expect(b.state?.answersText).toBe('tab 202');
  });

  it('origin mismatch returns reason=stale-tab and null state', async () => {
    const adapter = new MemoryStorageAdapter();
    const store = new PopupSessionStore(adapter);
    await store.save(101, makeState({ originHash: ORIGIN_A }));
    const r = await store.load(101, ORIGIN_B);
    expect(r.state).toBeNull();
    expect(r.reason).toBe('stale-tab');
  });

  it('returns reason=missing when nothing was saved', async () => {
    const adapter = new MemoryStorageAdapter();
    const store = new PopupSessionStore(adapter);
    const r = await store.load(101, ORIGIN_A);
    expect(r.state).toBeNull();
    expect(r.reason).toBe('missing');
  });

  it('delete removes the entry', async () => {
    const adapter = new MemoryStorageAdapter();
    const store = new PopupSessionStore(adapter);
    await store.save(101, makeState());
    await store.delete(101);
    const r = await store.load(101, ORIGIN_A);
    expect(r.state).toBeNull();
    expect(r.reason).toBe('missing');
  });
});

describe('PopupSessionStore — TTL', () => {
  it('returns the state when fresh', async () => {
    let clock = 1000;
    const store = new PopupSessionStore(new MemoryStorageAdapter(), {
      now: () => clock,
      ttlMs: 30 * 60 * 1000,
    });
    await store.save(101, makeState());
    clock = 1000 + 29 * 60 * 1000;
    const r = await store.load(101, ORIGIN_A);
    expect(r.state).not.toBeNull();
  });

  it('purges the entry and reports expired when older than ttlMs', async () => {
    let clock = 1000;
    const adapter = new MemoryStorageAdapter();
    const store = new PopupSessionStore(adapter, {
      now: () => clock,
      ttlMs: 1000,
    });
    await store.save(101, makeState());
    clock = 5000;
    const r = await store.load(101, ORIGIN_A);
    expect(r.state).toBeNull();
    expect(r.reason).toBe('expired');
  });
});

describe('PopupSessionStore — in-memory fallback', () => {
  it('works without a storage adapter', async () => {
    const store = new PopupSessionStore(null);
    await store.save(101, makeState());
    const r = await store.load(101, ORIGIN_A);
    expect(r.state?.answersText).toBe('1. a)\n2. b)');
  });

  it('survives storage throws on set', async () => {
    const adapter = new MemoryStorageAdapter();
    adapter.set = async () => {
      throw new Error('quota exceeded');
    };
    const store = new PopupSessionStore(adapter);
    await store.save(101, makeState());
    const r = await store.load(101, ORIGIN_A);
    expect(r.state?.answersText).toBe('1. a)\n2. b)');
  });

  it('survives storage throws on load (returns malformed)', async () => {
    const adapter = new MemoryStorageAdapter();
    const realGet = adapter.get.bind(adapter);
    adapter.get = async () => {
      void realGet;
      throw new Error('storage exploded');
    };
    const store = new PopupSessionStore(adapter);
    const r = await store.load(101, ORIGIN_A);
    expect(r.state).toBeNull();
    expect(r.reason).toBe('malformed');
  });
});

describe('PopupSessionStore — redactor (defense in depth)', () => {
  it('redacts canary patterns in answersText', async () => {
    const store = new PopupSessionStore(null);
    await expect(
      store.save(101, makeState({ answersText: 'sesskey=leaked123abc' })),
    ).rejects.toThrow();
  });

  it('does NOT redact lastDocumentJson (it contains legitimate SHA-256 hex)', async () => {
    // The QuizDocument's stableFingerprint is a 64-char hex string that
    // would always match the `long-hex-blob` canary. The document is our
    // own structured output (built by `buildQuizDocument` and validated
    // by `QuizDocumentSchema`), so we deliberately do not redact it.
    const store = new PopupSessionStore(null);
    const state = makeState({
      lastDocumentJson: JSON.stringify({
        schemaVersion: '1.0',
        questions: [
          {
            number: 1,
            stableFingerprint: 'a'.repeat(64),
            kind: 'single_choice',
            promptMarkdown: 'x',
            choices: [],
            metadata: {},
            assets: [],
            supportedForAutofill: true,
            warnings: [],
          },
        ],
      }),
    });
    // Should NOT throw — the long-hex canary is intentionally skipped
    // for the structured document.
    await expect(store.save(101, state)).resolves.toBeTruthy();
  });

  it('redacts canary patterns in lastJobId', async () => {
    const store = new PopupSessionStore(null);
    await expect(
      store.save(101, makeState({ lastJobId: 'sesskey=leaked123abc' })),
    ).rejects.toThrow();
  });
});

describe('PopupSessionStore — isExpired', () => {
  it('returns true when older than ttlMs', () => {
    let clock = 0;
    const store = new PopupSessionStore(null, { now: () => clock, ttlMs: 1000 });
    const state = makeState({ savedAt: 0 });
    clock = 5000;
    expect(store.isExpired(state)).toBe(true);
  });

  it('returns false when within ttlMs', () => {
    let clock = 0;
    const store = new PopupSessionStore(null, { now: () => clock, ttlMs: 1000 });
    const state = makeState({ savedAt: 0 });
    clock = 500;
    expect(store.isExpired(state)).toBe(false);
  });
});