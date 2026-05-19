"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useCalendarActions, useCalendarContext } from "@/hooks/useCalendar";
import { useJobPoller } from "@/hooks/useJobPoller";

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
  const queryClient = useQueryClient();
  const attemptedKeysRef = useRef<Set<string>>(new Set<string>());
  const [syncJobId, setSyncJobId] = useState<number | null>(null);
  const contextQuery = useCalendarContext();
  const { syncCalendar, isSyncingCalendar } = useCalendarActions();
  const syncJob = useJobPoller<Record<string, unknown>>(
    syncJobId,
    () => {
      setSyncJobId(null);
      void queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
      void queryClient.invalidateQueries({ queryKey: ["calendar-context"] });
    },
    { failureMessage: "Calendar bootstrap sync failed." },
  );
  const { start: startSyncJob, status: syncJobStatus } = syncJob;
  const isBootstrapSyncJobActive = syncJobStatus === "queued" || syncJobStatus === "running";
  const activeConnection = contextQuery.data?.connections.find((connection) => connection.sync_enabled_for_current_session && connection.provider === "google");
  const needsBootstrapSync = Boolean(
    activeConnection &&
      (!activeConnection.provider_calendar_id || !activeConnection.last_synced_at || Boolean(activeConnection.last_error)),
  );
  const bootstrapSyncKey = activeConnection
    ? [
        "google",
        activeConnection.account_email || "current-user",
        activeConnection.provider_calendar_id || "missing-calendar",
        activeConnection.last_error ? "last-error" : "bootstrap",
      ].join(":")
    : null;

  useEffect(() => {
    attemptedKeysRef.current = readAttemptedKeys();
  }, []);

  useEffect(() => {
    if (!bootstrapSyncKey) return;
    if (isSyncingCalendar) return;
    if (isBootstrapSyncJobActive) return;
    if (!needsBootstrapSync) return;

    if (attemptedKeysRef.current.has(bootstrapSyncKey)) return;
    attemptedKeysRef.current.add(bootstrapSyncKey);
    persistAttemptedKeys(attemptedKeysRef.current);

    void syncCalendar()
      .then((result) => {
        if (!result.job_id) return;
        setSyncJobId(result.job_id);
        startSyncJob(result.job_status || "queued", result.message || "Calendar sync queued.");
      })
      .catch((error) => {
        console.warn("Calendar bootstrap sync failed; manual retry remains available.", error);
      });
  }, [bootstrapSyncKey, isBootstrapSyncJobActive, isSyncingCalendar, needsBootstrapSync, syncCalendar, startSyncJob]);

  return null;
}
