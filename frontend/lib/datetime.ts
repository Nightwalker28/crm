"use client";

function readStoredTimezone() {
  if (typeof window === "undefined") return null;
  const cached = sessionStorage.getItem("lynk_user");
  if (!cached) return null;
  try {
    const parsed = JSON.parse(cached) as { timezone?: string | null };
    return parsed.timezone || null;
  } catch {
    return null;
  }
}

export function getUserTimezone() {
  return readStoredTimezone() || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function formatDateTime(value?: string | null, options?: Intl.DateTimeFormatOptions) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: getUserTimezone(),
      ...options,
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function formatDateOnly(value?: string | null, options?: Intl.DateTimeFormatOptions) {
  if (!value) return "";
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      ...options,
    }).format(date);
  }
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      ...options,
    }).format(new Date(value));
  } catch {
    return value;
  }
}

/** Today as `YYYY-MM-DD` in the user's timezone, for date inputs (not UTC's today). */
export function todayIsoDate() {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: getUserTimezone(), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
