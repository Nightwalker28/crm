/**
 * Short-lived draft handoff for Quick Create -> "More details".
 *
 * Entered values move to the canonical /new page through sessionStorage rather than the URL:
 * a query string would put customer contact details into history, the address bar, and any
 * referrer, and a Lead draft can contain a custom field a tenant treats as sensitive.
 * sessionStorage is tab-scoped, dies with the tab, and never leaves the browser.
 *
 * The draft is consumed once and expires, so a stale handoff can never silently repopulate a
 * later visit to /new.
 */

import { EMPTY_LEAD_FORM, type LeadFormValue } from "@/components/leads/LeadFormFields";

const DRAFT_STORAGE_KEY = "lynk:lead-quick-create-draft";
const DRAFT_TTL_MS = 10 * 60_000;

/** Marks a /new visit as a Quick Create handoff so an unrelated visit never restores a draft. */
export const LEAD_QUICK_CREATE_HANDOFF_PARAM = "draft";
export const LEAD_QUICK_CREATE_HANDOFF_VALUE = "quick-create";
export const LEAD_FULL_CREATE_ROUTE = "/dashboard/sales/leads/new";
export const LEAD_QUICK_CREATE_HANDOFF_ROUTE =
  `${LEAD_FULL_CREATE_ROUTE}?${LEAD_QUICK_CREATE_HANDOFF_PARAM}=${LEAD_QUICK_CREATE_HANDOFF_VALUE}`;

export type LeadQuickCreateDraft = {
  form: LeadFormValue;
  customFieldValues: Record<string, unknown>;
};

type StoredDraft = LeadQuickCreateDraft & { saved_at: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function saveLeadQuickCreateDraft(draft: LeadQuickCreateDraft) {
  if (typeof window === "undefined") return;
  try {
    const stored: StoredDraft = { ...draft, saved_at: Date.now() };
    window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // A full or unavailable sessionStorage only costs the prefill, so the handoff continues.
  }
}

export function clearLeadQuickCreateDraft() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // Nothing to recover from: the draft is already unreadable.
  }
}

/** Reads and removes the draft. Returns null when it is absent, expired, or malformed. */
export function consumeLeadQuickCreateDraft(): LeadQuickCreateDraft | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(DRAFT_STORAGE_KEY);
  } catch {
    return null;
  }
  clearLeadQuickCreateDraft();
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed.form)) return null;
    if (typeof parsed.saved_at !== "number" || Date.now() - parsed.saved_at > DRAFT_TTL_MS) return null;
    return {
      // Merged onto the empty form so a draft written by an older build cannot leave a field undefined.
      form: { ...EMPTY_LEAD_FORM, ...(parsed.form as Partial<LeadFormValue>) },
      customFieldValues: isRecord(parsed.customFieldValues) ? parsed.customFieldValues : {},
    };
  } catch {
    return null;
  }
}

/** True when the current location asked for a Quick Create handoff. */
export function isLeadQuickCreateHandoff(search: string) {
  return new URLSearchParams(search).get(LEAD_QUICK_CREATE_HANDOFF_PARAM) === LEAD_QUICK_CREATE_HANDOFF_VALUE;
}
