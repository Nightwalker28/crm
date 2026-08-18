import type { StatusTone } from "@/lib/statusStyles";
import type { ReactNode } from "react";

import { StatusValue } from "@/components/ui/StatusValue";
import { Card } from "@/components/ui/Card";

function statusLabel(status: string | null) {
  if (!status) return "Queued";
  return status.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function statusTone(status: string | null): StatusTone {
  if (status === "completed") {
    return "success";
  }
  if (status === "failed") {
    return "critical";
  }
  return "neutral";
}

type Props = {
  operation: "import" | "export";
  jobId: number;
  status: string | null;
  progress: number;
  message: string | null;
  hasError: boolean;
  completedDescription: string;
  failureMessage: string;
  children?: ReactNode;
};

export function DataTransferJobProgress({
  operation,
  jobId,
  status,
  progress,
  message,
  hasError,
  completedDescription,
  failureMessage,
  children,
}: Props) {
  const safeProgress = Math.min(100, Math.max(0, progress));
  const operationLabel = operation.charAt(0).toUpperCase() + operation.slice(1);

  return (
    <div className="space-y-4">
      <Card variant="muted" className="px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-copy-primary">Background {operation} #{jobId}</div>
            <div className="mt-1 text-sm text-copy-secondary">
              {status === "completed"
                ? completedDescription
                : status === "failed"
                  ? `${operationLabel} failed.`
                  : `${operationLabel} is running in the background.`}
            </div>
          </div>
          <StatusValue status={{ tone: statusTone(status), label: statusLabel(status) }} />
        </div>
        <div
          className="mt-4 h-2 overflow-hidden rounded-full bg-surface"
          role="progressbar"
          aria-label={`${operationLabel} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={safeProgress}
        >
          <div className="h-full rounded-full bg-primary transition-[width] duration-150" style={{ width: `${safeProgress}%` }} />
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-copy-muted">
          <span>{message || "Waiting for progress..."}</span>
          <span>{safeProgress}%</span>
        </div>
      </Card>
      {children}
      {hasError ? (
        <div role="alert" className="rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
          {failureMessage}
        </div>
      ) : null}
    </div>
  );
}
