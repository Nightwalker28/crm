/**
 * Keeping a deep link through sign-in (13a I2). An expired session sends the user to
 * `/auth/login?next=/dashboard/sales/orders`, and signing in lands them there instead of the
 * dashboard home. Provider sign-ins (Google, Microsoft, SSO) leave the app, so the path is
 * parked in sessionStorage for `/auth/callback` to pick up.
 *
 * Only paths inside the dashboard are honoured: an open redirect to another site, or to a
 * protocol-relative `//host`, is never followed.
 */

const DEFAULT_AFTER_SIGN_IN = "/dashboard";
const PENDING_KEY = "lynk:after-sign-in";

export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_AFTER_SIGN_IN;
  if (!raw.startsWith("/dashboard") || raw.startsWith("//") || raw.includes("\\")) return DEFAULT_AFTER_SIGN_IN;
  return raw;
}

export function loginPathFor(next: string | null | undefined): string {
  const target = safeNextPath(next);
  return target === DEFAULT_AFTER_SIGN_IN ? "/auth/login" : `/auth/login?next=${encodeURIComponent(target)}`;
}

/** The current page, for an expired session to come back to. */
export function currentPathForReturn(): string | null {
  if (typeof window === "undefined") return null;
  return `${window.location.pathname}${window.location.search}`;
}

export function parkNextPath(next: string | null | undefined) {
  try {
    const target = safeNextPath(next);
    if (target === DEFAULT_AFTER_SIGN_IN) window.sessionStorage.removeItem(PENDING_KEY);
    else window.sessionStorage.setItem(PENDING_KEY, target);
  } catch {
    // Storage blocked: the user lands on the dashboard home instead.
  }
}

export function takeParkedNextPath(): string {
  try {
    const value = window.sessionStorage.getItem(PENDING_KEY);
    window.sessionStorage.removeItem(PENDING_KEY);
    return safeNextPath(value);
  } catch {
    return DEFAULT_AFTER_SIGN_IN;
  }
}
