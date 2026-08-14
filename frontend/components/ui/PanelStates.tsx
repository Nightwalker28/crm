"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Inbox, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading } from "@/components/ui/SectionHeading";

/**
 * The four states, for a panel inside a page.
 *
 * `PageShell` and `RecordTable` already supply loading / empty / error / permission-denied for
 * a whole route and a whole table (7.4). Nothing supplied them for a *panel*, so this was
 * built inside `recordActivity/` and reached 5 files against roughly 40 panels — everyone
 * else re-implemented. It is promoted here unchanged in intent and corrected in two places:
 *
 * - **The header is a section heading**, so it steps down to 14px `text-copy-label` (R7). It
 *   was `text-lg text-copy-primary`, which put the words "Linked tasks" above the tasks at the
 *   same weight as the record's own name.
 * - **Loading and empty stopped being boxes.** R8: a box is earned by interactivity or by
 *   separation, never by grouping — and a state that *is* the panel's whole content at that
 *   moment is neither. They were a bordered `radius-control` box inside a bordered card, the
 *   third container level 1.3 forbids.
 *
 * The error state keeps its tinted ground. That is not hierarchy, it is state (2.4), and 7.5
 * requires the colour to be paired with text — which is why the retry sits inside it.
 */

export function PanelHeader({
  title,
  description,
  icon: Icon,
  action,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
}) {
  return (
    <SectionHeading
      description={description}
      action={
        <>
          {action}
          {Icon ? <Icon className="size-4 text-copy-muted" aria-hidden="true" /> : null}
        </>
      }
    >
      {title}
    </SectionHeading>
  );
}

export function PanelLoading({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      className="flex min-h-28 items-center justify-center gap-2 px-4 py-6 text-sm text-copy-muted"
    >
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      {label}
    </div>
  );
}

export function PanelError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex min-h-28 flex-col items-center justify-center rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted px-4 py-6 text-center"
    >
      <p className="text-sm font-medium text-copy-primary">{message}</p>
      <p className="mt-1 text-p-xs text-copy-muted">Check your connection and try again.</p>
      <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>
        <RefreshCw />
        Try again
      </Button>
    </div>
  );
}

export function PanelEmpty({
  title,
  description,
  icon = Inbox,
  action,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
}) {
  return <EmptyState icon={icon} title={title} description={description} action={action} />;
}
