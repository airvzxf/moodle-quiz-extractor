// src/moodle/applicators/no-submit-spy.ts
//
// T15 §Seguridad: the extension must NEVER submit the attempt, even by
// accident. We install spies on:
//   - HTMLFormElement.prototype.submit()
//   - HTMLFormElement.prototype.requestSubmit()
//   - fetch(...., 'processattempt.php')  (separate module: fetch-spy.ts)
//
// The spy is opt-in: tests call installNoSubmitSpy() to engage, and
// uninstall() to release. The content script does NOT install the spy by
// default — it only does so when the user is about to apply autofill.

export interface NoSubmitSpy {
  /** The number of attempts that the spy blocked. Exposed for tests. */
  blocked: () => number;
  /** Permanently disables the spy. */
  uninstall: () => void;
  /** Re-enables after a disable(). */
  enable: () => void;
  /** Temporarily disables (re-entrant: uses a refcount). */
  disable: () => void;
}

export function installNoSubmitSpy(
  document: Document,
  onBlock: (reason: string) => void = () => {},
): NoSubmitSpy {
  // Avoid `instanceof HTMLFormElement` because in JSDOM the constructor is on
  // the window object, not the Node global, so the check returns false. We
  // detect "this is a form" by checking tagName + the presence of `submit`.
  const form = document.getElementById('responseform') as
    | (HTMLFormElement & { submit: unknown; requestSubmit: unknown })
    | null;
  const isForm = form !== null && form.tagName === 'FORM';

  let blocks = 0;
  let disabledDepth = 0;
  let hardDisabled = false;

  const submitHandler = function (...args: unknown[]): void {
    if (hardDisabled || disabledDepth > 0) return;
    blocks += 1;
    onBlock(`form.${args.length === 0 ? 'submit' : 'requestSubmit'}() called`);
    throw new Error('MQX-FILL-304: submit blocked by no-submit invariant');
  };

  // Patch ONLY the responseform instance, not the prototype, so other forms
  // (login form, prefs form) remain functional.
  if (isForm && form) {
    form.submit = function (..._args: unknown[]): void {
      submitHandler();
    } as HTMLFormElement['submit'];
    form.requestSubmit = function (..._args: unknown[]): void {
      submitHandler();
    } as HTMLFormElement['requestSubmit'];
  }

  return {
    blocked: () => blocks,
    uninstall: () => {
      hardDisabled = true;
      if (isForm && form) {
        // Restore the original no-op methods. We can't recover the real
        // HTMLFormElement.prototype.submit, so we install harmless stubs;
        // by the time the spy is uninstalled the user is explicitly
        // submitting, and a no-op call is safer than another patch.
        form.submit = function () {} as HTMLFormElement['submit'];
        form.requestSubmit = function () {} as HTMLFormElement['requestSubmit'];
      }
    },
    enable: () => {
      hardDisabled = false;
    },
    disable: () => {
      disabledDepth += 1;
    },
  };
}
