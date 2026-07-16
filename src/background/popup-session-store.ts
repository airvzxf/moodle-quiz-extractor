// src/background/popup-session-store.ts
//
// Persists the popup's work-in-progress state (extracted QuizDocument,
// user's answers textarea, autofill jobId) in `browser.storage.session`
// with a hard TTL (default 30 min). Mirrors the `JobStore` API so the
// popup can hydrate on open and debounce-persist on every change.
//
// Why this exists: Firefox MV3 destroys the popup when it loses focus
// (e.g. the user switches to another window). Without persistence, the
// user has to redo Extract → Autofill → paste → Validate every time
// they alt-tab. With persistence, the popup reopens exactly as they
// left it (including a silent `prepareAutofill` to rebuild the in-memory
// job that lives in the content script).
//
// Storage choice: `storage.session` (NOT `storage.local`, NOT `storage.sync`)
// — same TTL discipline as `JobStore`. `storage.session` is ephemeral and
// per browser profile; it never crosses devices and dies when Firefox
// closes. The user's answers never leave the local profile.

import { redactString } from '~/diagnostics/redactor';
import { MemoryStorageAdapter, type StorageAdapter } from './job-store';

export const POPUP_SESSION_SCHEMA_VERSION = '1.0';
export const DEFAULT_POPUP_SESSION_TTL_MS = 30 * 60 * 1000;
const KEY_PREFIX = 'mqx:popup:';

export interface PopupSessionState {
  readonly schemaVersion: typeof POPUP_SESSION_SCHEMA_VERSION;
  readonly originHash: string;
  /** epoch ms when this state was saved. */
  readonly savedAt: number;
  /** The user's answers textarea content. */
  readonly answersText: string;
  /** Serialized QuizDocument (JSON). */
  readonly lastDocumentJson: string;
  /** UUID of the active autofill job in the content script (may be null). */
  readonly lastJobId: string | null;
  /** True when the popup is in 'autofill' state (vs 'extract' only). */
  readonly hasAutofillContext: boolean;
}

export interface PopupSessionStoreOptions {
  readonly ttlMs?: number;
  readonly now?: () => number;
}

export interface PopupSessionLoadResult {
  readonly state: PopupSessionState | null;
  readonly skipped: boolean;
  readonly reason?: 'missing' | 'expired' | 'stale-tab' | 'malformed';
}

export class PopupSessionStore {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly memory = new Map<string, PopupSessionState>();

  constructor(
    private readonly storage: StorageAdapter | null,
    options: PopupSessionStoreOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? DEFAULT_POPUP_SESSION_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  /** Save (or overwrite) the popup session for the given tab. */
  async save(tabId: number, state: PopupSessionState): Promise<PopupSessionState> {
    const safe = sanitize(state);
    const stamped: PopupSessionState = { ...safe, savedAt: this.now() };
    const key = this.key(tabId);
    this.memory.set(key, stamped);
    if (!this.storage) return stamped;
    try {
      await this.storage.set(key, { value: stamped });
    } catch {
      // Quota / unavailable — in-memory still works for this SW lifetime.
    }
    return stamped;
  }

  /**
   * Load the popup session for the given tab. The caller passes the
   * CURRENT origin hash so the store can detect when the user navigated
   * the tab to a different Moodle origin (or away from Moodle) — in that
   * case the saved state is stale and the caller should start fresh.
   */
  async load(
    tabId: number,
    currentOriginHash: string,
  ): Promise<PopupSessionLoadResult> {
    const key = this.key(tabId);
    let state = this.memory.get(key) ?? null;
    if (!state && this.storage) {
      try {
        const raw = await this.storage.get(key);
        const candidate = raw?.['value'] as PopupSessionState | undefined;
        if (candidate) {
          state = candidate;
          this.memory.set(key, candidate);
        }
      } catch {
        return { state: null, skipped: false, reason: 'malformed' };
      }
    }
    if (!state) return { state: null, skipped: false, reason: 'missing' };
    if (state.originHash !== currentOriginHash) {
      await this.delete(tabId);
      return { state: null, skipped: false, reason: 'stale-tab' };
    }
    if (this.isExpired(state)) {
      await this.delete(tabId);
      return { state: null, skipped: false, reason: 'expired' };
    }
    return { state, skipped: false };
  }

  /** Removes the session for the given tab. */
  async delete(tabId: number): Promise<void> {
    const key = this.key(tabId);
    this.memory.delete(key);
    if (!this.storage) return;
    try {
      await this.storage.remove(key);
    } catch {
      // Best-effort; future loads will miss it.
    }
  }

  isExpired(state: PopupSessionState): boolean {
    return this.now() - state.savedAt > this.ttlMs;
  }

  private key(tabId: number): string {
    return `${KEY_PREFIX}${tabId}`;
  }
}

function sanitize(state: PopupSessionState): PopupSessionState {
  // originHash is our own SHA-256 of the page origin, generated by
  // fingerprint() — NOT a secret, so redactString would only reject
  // it (the long-hex-blob canary matches our own hash). We only redact
  // user-provided fields (answersText, lastDocumentJson, lastJobId).
  return {
    schemaVersion: POPUP_SESSION_SCHEMA_VERSION,
    originHash: state.originHash,
    savedAt: state.savedAt,
    answersText: redactString(state.answersText),
    lastDocumentJson: redactString(state.lastDocumentJson),
    lastJobId: state.lastJobId ? redactString(state.lastJobId) : null,
    hasAutofillContext: state.hasAutofillContext,
  };
}

// Re-export the test adapter so callers (tests) can build a
// memory-only store without importing the job-store module again.
export { MemoryStorageAdapter };
export type { StorageAdapter };