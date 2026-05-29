"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useRealtimeJobStatus } from "@/hooks/useRealtimeJobStatus";

export type DataTransferJobResponse<TSummary = Record<string, unknown>> = {
  id: number;
  status: string;
  summary?: TSummary | null;
  result_file_name?: string | null;
  error_message?: string | null;
  progress_percent?: number;
  progress_message?: string | null;
};

type UseJobPollerOptions = {
  failureMessage: string;
};

export function useJobPoller<TSummary>(
  jobId: number | null,
  onComplete: (job: DataTransferJobResponse<TSummary>) => void,
  { failureMessage }: UseJobPollerOptions,
) {
  const onCompleteRef = useRef(onComplete);
  const failureMessageRef = useRef(failureMessage);
  const statusRef = useRef<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    onCompleteRef.current = onComplete;
    failureMessageRef.current = failureMessage;
  });

  const updateStatus = useCallback((nextStatus: string | null) => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }, []);

  const applyJobUpdate = useCallback((body: DataTransferJobResponse<TSummary>) => {
    updateStatus(body.status);
    setProgress(body.progress_percent ?? 0);
    setMessage(body.progress_message ?? null);
    if (body.status === "completed") {
      setError(null);
      onCompleteRef.current(body);
    } else if (body.status === "failed") {
      setError(body.error_message || failureMessageRef.current);
    }
  }, [updateStatus]);

  const realtime = useRealtimeJobStatus(
    jobId,
    applyJobUpdate,
    Boolean(jobId && status && ["queued", "running"].includes(status)),
  );

  useEffect(() => {
    if (!jobId) return;
    if (!statusRef.current || !["queued", "running"].includes(statusRef.current)) return;

    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const res = await apiFetch(`/jobs/data-transfer/${jobId}`);
        const body = (await res.json().catch(() => null)) as DataTransferJobResponse<TSummary> | null;
        if (!res.ok || !body || cancelled) return;
        if (body.status === "completed" || body.status === "failed") {
          window.clearInterval(timer);
        }
        applyJobUpdate(body);
      } catch {
        // Keep polling quietly; transient fetch retry is handled by apiFetch.
      }
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [applyJobUpdate, jobId, updateStatus]);

  const start = useCallback((nextStatus = "queued", nextMessage: string | null = null) => {
    updateStatus(nextStatus);
    setError(null);
    setProgress(0);
    setMessage(nextMessage);
  }, [updateStatus]);

  const reset = useCallback(() => {
    updateStatus(null);
    setError(null);
    setProgress(0);
    setMessage(null);
  }, [updateStatus]);

  return {
    status,
    setStatus,
    error,
    setError,
    progress,
    setProgress,
    message,
    setMessage,
    realtimeStatus: realtime.status,
    start,
    reset,
  };
}
