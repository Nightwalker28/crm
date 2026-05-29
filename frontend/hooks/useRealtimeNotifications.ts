"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { apiUrl } from "@/lib/runtime-config";

type RealtimeStatus = "idle" | "connected" | "reconnecting" | "unsupported";

export function useRealtimeNotifications(enabled = true) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>(() => (
    typeof window !== "undefined" && !("EventSource" in window) ? "unsupported" : "idle"
  ));

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      return;
    }
    if (!("EventSource" in window)) {
      return;
    }

    const source = new EventSource(apiUrl("/platform/realtime/stream"), { withCredentials: true });
    const refreshNotifications = () => {
      void queryClient.invalidateQueries({ queryKey: ["user-notifications"] });
    };

    source.addEventListener("open", () => setStatus("connected"));
    source.addEventListener("error", () => setStatus("reconnecting"));
    source.addEventListener("notification.created", refreshNotifications);
    source.addEventListener("notification.updated", refreshNotifications);

    return () => {
      source.removeEventListener("notification.created", refreshNotifications);
      source.removeEventListener("notification.updated", refreshNotifications);
      source.close();
    };
  }, [enabled, queryClient]);

  return { status };
}
