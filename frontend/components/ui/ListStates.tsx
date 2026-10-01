"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Inbox, ShieldX, TriangleAlert } from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/button";

export type ListStateSlot = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
};

type ListStateOptions = {
  /** The plural noun, as the list's `RecordTable` `label` — `"Tasks"`. */
  label: string;
  hasItems: boolean;
  isLoading?: boolean;
  isPermissionDenied?: boolean;
  hasError?: boolean;
  onRetry?: () => void;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
  emptyState: ListStateSlot;
  /** The table's own filtered copy, when it has one — every display says what the table says. */
  filteredEmptyState?: Partial<ListStateSlot>;
};

/**
 * The §7.4 states for a list's *other* displays — `Board` and the task calendar's `MonthGrid`.
 *
 * They render the same loaded rows as the table, so they say the same thing in the same order
 * and words as `RecordTable`: no access, then failed, then arrived empty. `Board` wrote this
 * out in 5.7 batch 4; the calendar would have been the third copy, so it lives here. Returns
 * `null` when the display should draw its content — including while loading, which each
 * display draws in its own shape.
 */
export function renderListState({
  label,
  hasItems,
  isLoading = false,
  isPermissionDenied = false,
  hasError = false,
  onRetry,
  hasActiveFilters = false,
  onClearFilters,
  emptyState,
  filteredEmptyState,
}: ListStateOptions): ReactNode {
  const itemsLabel = label.toLocaleLowerCase();
  if (isPermissionDenied) {
    return (
      <div role="alert">
        <EmptyState
          icon={ShieldX}
          title={`You do not have access to ${itemsLabel}`}
          description="Ask an administrator for the required module or action access."
        />
      </div>
    );
  }
  if (isLoading) return null;
  if (hasError) {
    return (
      <div role="alert">
        <EmptyState
          icon={TriangleAlert}
          title={`${label} could not be loaded`}
          description="Check your connection and try again."
          action={onRetry ? <Button type="button" variant="outline" onClick={onRetry}>Try again</Button> : undefined}
        />
      </div>
    );
  }
  if (hasItems) return null;
  if (hasActiveFilters) {
    return (
      <EmptyState
        icon={filteredEmptyState?.icon ?? emptyState.icon ?? Inbox}
        title={filteredEmptyState?.title ?? `No ${itemsLabel} match these filters`}
        description={filteredEmptyState?.description ?? "Clear one or more filters and try again."}
        action={
          filteredEmptyState?.action ??
          (onClearFilters ? <Button type="button" variant="outline" onClick={onClearFilters}>Clear filters</Button> : undefined)
        }
      />
    );
  }
  return <EmptyState icon={emptyState.icon ?? Inbox} title={emptyState.title} description={emptyState.description} action={emptyState.action} />;
}
