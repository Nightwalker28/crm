/**
 * External (click-to-chat) WhatsApp — the one place the frontend opens it.
 *
 * `external_link` mode opens WhatsApp with the number (and, on the tracked contact path,
 * the text) filled in; the operator presses send there. Lynk learns nothing after that, so
 * no copy built on this may say a message was sent, delivered or read (06 Phase 1).
 *
 * Three surfaces open it: the record header's WhatsApp button, the Timeline composer's
 * WhatsApp follow-up, and the contact's tracked click-to-chat, whose URL the server builds.
 * They share the number rules and the popup-safe window here instead of each keeping a
 * copy.
 */

export type WhatsAppChatTarget =
  | { ok: true; digits: string }
  | { ok: false; reason: "missing" | "needs-country-code" | "invalid" };

export const WHATSAPP_NUMBER_MESSAGES: Record<Exclude<WhatsAppChatTarget, { ok: true }>["reason"], string> = {
  missing: "Add a phone number before opening WhatsApp.",
  "needs-country-code": "Add the country code to this phone number to open WhatsApp.",
  invalid: "Add a valid phone number before opening WhatsApp.",
};

/**
 * The digits WhatsApp dials, or why there are none.
 *
 * No country calling code starts with 0, so a number that does after its `+`/`00` prefix
 * is national (`077 123 4567`) and WhatsApp cannot resolve it — opening it only shows
 * WhatsApp's "invalid number" screen. The server's normalizer can add the workspace
 * country for the tracked contact path; these untracked paths have no country to add, so
 * they say what to fix instead. The 7-digit floor matches the server's.
 */
export function whatsAppChatTarget(phone: string | null | undefined): WhatsAppChatTarget {
  const raw = (phone ?? "").trim();
  if (!raw) return { ok: false, reason: "missing" };
  let digits = raw.replace(/\D/g, "");
  if (raw.startsWith("00")) digits = digits.slice(2);
  else if (!raw.startsWith("+") && digits.startsWith("0")) return { ok: false, reason: "needs-country-code" };
  if (digits.length < 7) return { ok: false, reason: "invalid" };
  return { ok: true, digits };
}

export function whatsAppChatUrl(digits: string) {
  return `https://wa.me/${digits}`;
}

/**
 * A window opened *synchronously* in the click handler, pointed at WhatsApp later.
 *
 * Opening a window after an `await` is a popup the browser may block, and every path that
 * logs before it opens has an `await`. Call this before the first one, then `go(url)` on
 * success or `cancel()` on failure.
 */
export function openPendingWhatsAppWindow() {
  const pending =
    typeof window !== "undefined" && typeof window.open === "function"
      ? window.open("about:blank", "_blank")
      : null;
  if (pending) pending.opener = null;
  return {
    go(url: string) {
      if (pending && !pending.closed) pending.location.href = url;
      else window.open(url, "_blank", "noopener,noreferrer");
    },
    cancel() {
      pending?.close();
    },
  };
}
