"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Inbox, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";

export function RecordPanelHeader({
  title,
  description,
  icon: Icon,
  action,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-copy-primary">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-copy-muted">{description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {action}
        <Icon className="h-5 w-5 text-copy-muted" aria-hidden="true" />
      </div>
    </div>
  );
}

export function RecordPanelLoading({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" className="flex min-h-28 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-4 py-6 text-sm text-copy-muted">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      {label}
    </div>
  );
}

export function RecordPanelError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div role="alert" className="flex min-h-28 flex-col items-center justify-center rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted px-4 py-6 text-center">
      <p className="text-sm font-medium text-copy-primary">{message}</p>
      <p className="mt-1 text-xs leading-5 text-copy-muted">Check your connection and try again.</p>
      <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>
        <RefreshCw />
        Try again
      </Button>
    </div>
  );
}

export function RecordPanelEmpty({
  title,
  description,
  icon = Inbox,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="rounded-[var(--radius-control)] border border-dashed border-line-default bg-surface-muted">
      <EmptyState icon={icon} title={title} description={description} />
    </div>
  );
}
