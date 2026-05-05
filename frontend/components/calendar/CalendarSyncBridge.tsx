"use client";

import { useEffect, useRef } from "react";

import { useCalendarActions, useCalendarContext } from "@/hooks/useCalendar";

const AUTO_SYNC_KEY = "lynk:calendar-auto-sync";

function readAttemptedKeys() {
  if (typeof window === "undefined") return new Set<string>();
  try {
    const raw = window.sessionStorage.getItem(AUTO_SYNC_KEY);
    if (!raw) return new Set<string>();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function persistAttemptedKeys(values: Set<string>) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(AUTO_SYNC_KEY, JSON.stringify(Array.from(values)));
}

export default function CalendarSyncBridge() {
  const attemptedKeysRef = useRef<Set<string>>(new Set<string>());
  const contextQuery = useCalendarContext();
  const { syncCalendar, isSyncingCalendar } = useCalendarActions();

  useEffect(() => {
    attemptedKeysRef.current = readAttemptedKeys();
  }, []);

  useEffect(() => {
    const activeConnection = contextQuery.data?.connections.find((connection) => connection.sync_enabled_for_current_session);
    if (!activeConnection) return;
    if (activeConnection.provider !== "google") return;
    if (isSyncingCalendar) return;

    const needsBootstrapSync =
      !activeConnection.provider_calendar_id ||
      !activeConnection.last_synced_at ||
      Boolean(activeConnection.last_error);

    if (!needsBootstrapSync) return;

    const key = [
      activeConnection.provider,
      activeConnection.account_email || "current-user",
      activeConnection.provider_calendar_id || "missing-calendar",
      activeConnection.last_synced_at || "never-synced",
    ].join(":");

    if (attemptedKeysRef.current.has(key)) return;
    attemptedKeysRef.current.add(key);
    persistAttemptedKeys(attemptedKeysRef.current);

    void syncCalendar().catch(() => {
      // The calendar page exposes the detailed state and a manual retry path.
    });
  }, [contextQuery.data?.connections, isSyncingCalendar, syncCalendar]);

  return null;
}
