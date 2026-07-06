"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { DataTransferJobResponse } from "@/hooks/useJobPoller";
import { realtimeInitialStatus, subscribeRealtimeStream } from "@/lib/realtime";

export function useRealtimeJobStatus<TSummary>(
  jobId: number | null,
  onUpdate: (job: DataTransferJobResponse<TSummary>) => void,
  enabled = true,
) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState(realtimeInitialStatus);

  useEffect(() => {
    if (!enabled || !jobId) {
      return;
    }

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

    return subscribeRealtimeStream({
      "job.updated": handleJobUpdate as EventListener,
    }, setStatus);
  }, [enabled, jobId, onUpdate, queryClient]);

  return { status };
}
