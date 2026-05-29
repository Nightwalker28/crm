"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { DataTransferJobResponse } from "@/hooks/useJobPoller";
import { apiUrl } from "@/lib/runtime-config";

type RealtimeStatus = "idle" | "connected" | "reconnecting" | "unsupported";

export function useRealtimeJobStatus<TSummary>(
  jobId: number | null,
  onUpdate: (job: DataTransferJobResponse<TSummary>) => void,
  enabled = true,
) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>(() => (
    typeof window !== "undefined" && !("EventSource" in window) ? "unsupported" : "idle"
  ));

  useEffect(() => {
    if (!enabled || !jobId || typeof window === "undefined") {
      return;
    }
    if (!("EventSource" in window)) {
      return;
    }

    const source = new EventSource(apiUrl("/platform/realtime/stream"), { withCredentials: true });
    const handleJobUpdate = (event: MessageEvent) => {
      let payload: DataTransferJobResponse<TSummary>;
      try {
        payload = JSON.parse(event.data) as DataTransferJobResponse<TSummary>;
      } catch {
        return;
      }
      if (payload.id !== jobId) return;
      onUpdate(payload);
      void queryClient.invalidateQueries({ queryKey: ["data-transfer-jobs"] });
    };

    source.addEventListener("open", () => setStatus("connected"));
    source.addEventListener("error", () => setStatus("reconnecting"));
    source.addEventListener("job.updated", handleJobUpdate as EventListener);

    return () => {
      source.removeEventListener("job.updated", handleJobUpdate as EventListener);
      source.close();
    };
  }, [enabled, jobId, onUpdate, queryClient]);

  return { status };
}
