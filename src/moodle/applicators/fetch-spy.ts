// src/moodle/applicators/fetch-spy.ts
//
// T15 §Seguridad: the extension must NEVER submit the attempt, even by
// a creative path. We already spy on `HTMLFormElement.prototype.submit`
// and `.requestSubmit` (no-submit-spy.ts); this module closes the
// remaining hole — `fetch(...., 'processattempt.php')`.
//
// The spy wraps the page's `window.fetch` (and the equivalent
// `globalThis.fetch`) and blocks every call that:
//   - targets `/mod/quiz/attempt.php` (the submission endpoint), AND
//   - uses a non-GET method, AND
//   - the URL query string contains `finishattempt` or `processattempt`.
//
// GETs are always passed through — they cannot mutate the attempt. The
// content script installs the spy ONLY while the user is about to apply
// autofill; the rest of the time the original fetch is untouched so the
// page works normally.

const PROCESSATTEMPT_PATTERN = /\/mod\/quiz\/attempt\.php\?.*(?:finishattempt|processattempt)/i;

export interface FetchSpy {
  /** Number of attempts the spy blocked. */
  blocked: () => number;
  /** Permanently disables the spy. */
  uninstall: () => void;
  /** Re-enables after a disable(). */
  enable: () => void;
  /** Temporarily disables (re-entrant: uses a refcount). */
  disable: () => void;
}

export interface FetchLikeEnvironment {
  /** Original `fetch` to wrap. */
  fetchImpl: typeof fetch;
  /** Object on which to install the wrapped fetch (window in a real page). */
  target: { fetch: typeof fetch };
}

export function installFetchSpy(
  env: FetchLikeEnvironment,
  onBlock: (reason: string) => void = () => {},
): FetchSpy {
  const original = env.fetchImpl;
  let blocks = 0;
  let disabledDepth = 0;
  let hardDisabled = false;

  const wrapped: typeof fetch = async function wrappedFetch(
    input: unknown,
    init?: RequestInit,
  ): Promise<Response> {
    if (hardDisabled || disabledDepth > 0) {
      return original.call(env.target.fetch, input as RequestInfo, init);
    }
    const url = resolveUrl(input, init);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method === 'GET') {
      return original.call(env.target.fetch, input as RequestInfo, init);
    }
    if (url && PROCESSATTEMPT_PATTERN.test(url)) {
      blocks += 1;
      onBlock(`fetch(${method} ${url}) blocked by fetch-spy`);
      throw new Error('MQX-FILL-305: submit blocked by fetch-spy invariant');
    }
    return original.call(env.target.fetch, input as RequestInfo, init);
  } as typeof fetch;

  env.target.fetch = wrapped;

  return {
    blocked: () => blocks,
    uninstall: () => {
      hardDisabled = true;
      env.target.fetch = original;
    },
    enable: () => {
      hardDisabled = false;
      disabledDepth = 0;
    },
    disable: () => {
      disabledDepth += 1;
    },
  };
}

function resolveUrl(input: unknown, init?: RequestInit): string | null {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  if (init?.headers) {
    // Some callers put the URL in headers by mistake; ignore.
  }
  return null;
}