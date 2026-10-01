/**
 * Short-lived draft handoff for Quick Create -> "More details".
 *
 * Entered values move to the canonical /new page through sessionStorage rather than the URL:
 * a query string would put customer contact details into history, the address bar, and any
 * referrer, and a draft can contain a custom field a tenant treats as sensitive.
 * sessionStorage is tab-scoped, dies with the tab, and never leaves the browser.
 *
 * The draft is consumed once and expires, so a stale handoff can never silently repopulate a
 * later visit to /new.
 *
 * One store per module, created by `createQuickCreateDraftStore`. The shape of the form is the
 * module's business; everything here is storage, expiry, and single-use semantics.
 */

const DRAFT_TTL_MS = 10 * 60_000;

/** Marks a /new visit as a Quick Create handoff so an unrelated visit never restores a draft. */
export const QUICK_CREATE_HANDOFF_PARAM = "draft";
export const QUICK_CREATE_HANDOFF_VALUE = "quick-create";

export type QuickCreateDraft<TForm> = {
  form: TForm;
  customFieldValues: Record<string, unknown>;
};

type StoredDraft<TForm> = QuickCreateDraft<TForm> & { saved_at: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when the current location asked for a Quick Create handoff. */
export function isQuickCreateHandoff(search: string) {
  return new URLSearchParams(search).get(QUICK_CREATE_HANDOFF_PARAM) === QUICK_CREATE_HANDOFF_VALUE;
}

export function createQuickCreateDraftStore<TForm extends Record<string, unknown>>({
  storageKey,
  fullCreateRoute,
  emptyForm,
}: {
  storageKey: string;
  fullCreateRoute: string;
  emptyForm: TForm;
}) {
  const handoffRoute = `${fullCreateRoute}?${QUICK_CREATE_HANDOFF_PARAM}=${QUICK_CREATE_HANDOFF_VALUE}`;

  function clear() {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.removeItem(storageKey);
    } catch {
      // Nothing to recover from: the draft is already unreadable.
    }
  }

  function save(draft: QuickCreateDraft<TForm>) {
    if (typeof window === "undefined") return;
    try {
      const stored: StoredDraft<TForm> = { ...draft, saved_at: Date.now() };
      window.sessionStorage.setItem(storageKey, JSON.stringify(stored));
    } catch {
      // A full or unavailable sessionStorage only costs the prefill, so the handoff continues.
    }
  }

  /** Reads and removes the draft. Returns null when it is absent, expired, or malformed. */
  function consume(): QuickCreateDraft<TForm> | null {
    if (typeof window === "undefined") return null;
    let raw: string | null = null;
    try {
      raw = window.sessionStorage.getItem(storageKey);
    } catch {
      return null;
    }
    clear();
    if (!raw) return null;

    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed) || !isRecord(parsed.form)) return null;
      if (typeof parsed.saved_at !== "number" || Date.now() - parsed.saved_at > DRAFT_TTL_MS) return null;
      return {
        // Merged onto the empty form so a draft written by an older build cannot leave a field undefined.
        form: { ...emptyForm, ...(parsed.form as Partial<TForm>) },
        customFieldValues: isRecord(parsed.customFieldValues) ? parsed.customFieldValues : {},
      };
    } catch {
      return null;
    }
  }

  return { fullCreateRoute, handoffRoute, save, clear, consume, isHandoff: isQuickCreateHandoff };
}
