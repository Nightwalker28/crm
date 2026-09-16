"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { GripVertical, Inbox, ShieldX, TriangleAlert } from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { StatusValue } from "@/components/ui/StatusValue";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatusDescriptor } from "@/lib/statusStyles";
import { cn } from "@/lib/utils";

export type BoardColumn = {
  key: string;
  label: string;
  status: StatusDescriptor;
  /**
   * `false` for a column that only collects what fits nowhere else — the pipeline's
   * *Unstaged*. Its cards show, but it is neither a drop target nor a move option.
   */
  acceptsCards?: boolean;
};

type StateSlot = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
};

type BoardProps<T> = {
  /** The plural noun, as the matching `RecordTable`'s `label` — `"Tasks"`. Names the region, each column and the states. */
  label: string;
  /** The field a column stands for — `"status"`. Names the move control. */
  moveFieldLabel: string;
  columns: BoardColumn[];
  items: T[];
  getKey: (item: T) => string | number;
  /** The column key an item belongs in. Must be one of `columns`; the caller normalises. */
  getColumn: (item: T) => string;
  getItemLabel: (item: T) => string;
  /** The card's open gesture: a link when the record has a page… */
  getItemHref?: (item: T) => string;
  /** …or a button when it opens in place. */
  onOpenItem?: (item: T) => void;
  onMove: (item: T, column: string) => Promise<void> | void;
  /** Everything between the title and the move control. The card box is the board's. */
  renderCardBody: (item: T) => ReactNode;

  isLoading?: boolean;
  isRefreshing?: boolean;
  isPermissionDenied?: boolean;
  hasError?: boolean;
  onRetry?: () => void;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
  emptyState: StateSlot;
  /** The table's own filtered copy, when it has one — the board says what the table says. */
  filteredEmptyState?: Partial<StateSlot>;
};

/**
 * A kanban (rebuild 5.7 ruling 4, design.md §7.13).
 *
 * The task board and the deal pipeline were the same component written twice: a bordered
 * panel of tinted column boxes holding bordered cards — three container levels — with the
 * hovered column painted in the primary action's tint, and each separately remembering that
 * HTML5 drag has no keyboard path. Here that is one contract:
 *
 * - **It is the other half of a list.** The same loaded rows as the table, so the same
 *   `ModuleTableShell` and the same four states, in `RecordTable`'s order and words.
 * - **Columns are ink groups**, cards are rows (§1.3). The board owns the card box; the call
 *   site supplies only the body, so the two boards cannot drift apart again.
 * - **The move control is the accessible path** and the drag is an enhancement over it.
 * - **Focus follows the card.** A card that changes column is a new DOM node, so after a
 *   keyboard move focus goes to the move control where the card now is.
 * - **The drop target is elevation**, `border-line-strong` on `bg-surface-raised`.
 *
 * No announcement of its own: both pages confirm a move with a toast, which is already a live
 * region, and one change gets one message.
 */
export function Board<T>({
  label,
  moveFieldLabel,
  columns,
  items,
  getKey,
  getColumn,
  getItemLabel,
  getItemHref,
  onOpenItem,
  onMove,
  renderCardBody,
  isLoading = false,
  isRefreshing = false,
  isPermissionDenied = false,
  hasError = false,
  onRetry,
  hasActiveFilters = false,
  onClearFilters,
  emptyState,
  filteredEmptyState,
}: BoardProps<T>) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropColumn, setDropColumn] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<{ key: string; column: string } | null>(null);
  const itemsLabel = label.toLocaleLowerCase();
  const moveOptions = columns.filter((column) => column.acceptsCards !== false);

  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending || !boardRef.current) return;
    const card = boardRef.current.querySelector<HTMLElement>(
      `[data-board-column="${CSS.escape(pending.column)}"] [data-board-card="${CSS.escape(pending.key)}"]`,
    );
    if (!card) return;
    pendingFocus.current = null;
    card.querySelector<HTMLElement>("[data-board-move]")?.focus();
  });

  function move(item: T, column: string, fromKeyboard: boolean) {
    if (getColumn(item) === column) return;
    const key = String(getKey(item));
    if (fromKeyboard) pendingFocus.current = { key, column };
    // A move that fails leaves the card where it was, so the focus it was waiting for never
    // arrives. Drop the request once the move settles rather than let it fire on a later one.
    void Promise.resolve(onMove(item, column)).finally(() => {
      window.requestAnimationFrame(() => {
        if (pendingFocus.current?.key === key) pendingFocus.current = null;
      });
    });
  }

  function endDrag() {
    setDragKey(null);
    setDropColumn(null);
  }

  function renderState() {
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
    if (items.length) return null;
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

  const state = renderState();

  return (
    <ModuleTableShell label={label} isLoading={isLoading} isRefreshing={isRefreshing}>
      {state ?? (
        <div ref={boardRef} data-slot="board" className="flex min-w-max gap-2 p-2">
          {columns.map((column) => {
            const columnItems = isLoading ? [] : items.filter((item) => getColumn(item) === column.key);
            const acceptsCards = column.acceptsCards !== false;
            const isDropTarget = dropColumn === column.key && dragKey !== null;
            return (
              <section
                key={column.key}
                aria-label={`${column.label} ${itemsLabel}`}
                data-board-column={column.key}
                data-drop-target={isDropTarget || undefined}
                onDragOver={(event) => {
                  if (!acceptsCards || dragKey === null) return;
                  event.preventDefault();
                  if (dropColumn !== column.key) setDropColumn(column.key);
                }}
                onDragLeave={(event) => {
                  if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                  setDropColumn((current) => (current === column.key ? null : current));
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const item = items.find((candidate) => String(getKey(candidate)) === dragKey);
                  endDrag();
                  if (item && acceptsCards) move(item, column.key, false);
                }}
                className={cn(
                  "flex w-68 shrink-0 flex-col rounded-[var(--radius-control)] border border-transparent transition-colors duration-150 motion-reduce:transition-none",
                  isDropTarget && "border-line-strong bg-surface-raised",
                )}
              >
                <div className="flex items-center justify-between gap-2 px-2 py-2">
                  <StatusValue status={{ ...column.status, label: column.label }} />
                  <span className="text-xs tabular-nums text-copy-muted">
                    {isLoading ? null : columnItems.length}
                  </span>
                </div>
                <ol className="flex min-h-48 flex-col gap-2 px-2 pb-2">
                  {isLoading ? (
                    [0, 1].map((index) => (
                      <li key={index} className="rounded-[var(--radius-control)] border border-line-subtle p-3">
                        <Skeleton className="h-4 w-40" />
                        <Skeleton className="mt-3 h-3 w-28" />
                        <Skeleton className="mt-2 h-3 w-24" />
                      </li>
                    ))
                  ) : columnItems.length ? (
                    columnItems.map((item) => {
                      const key = String(getKey(item));
                      const itemLabel = getItemLabel(item);
                      const href = getItemHref?.(item);
                      const current = getColumn(item);
                      return (
                        <li
                          key={key}
                          data-board-card={key}
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = "move";
                            // Firefox starts no drag without data.
                            event.dataTransfer.setData("text/plain", key);
                            setDragKey(key);
                          }}
                          onDragEnd={endDrag}
                          className={cn(
                            "rounded-[var(--radius-control)] border border-line-subtle p-3 transition-[border-color,opacity] duration-150 hover:border-line-strong motion-reduce:transition-none",
                            dragKey === key && "opacity-60",
                          )}
                        >
                          <div className="flex items-start gap-2">
                            <GripVertical className="mt-0.5 size-4 shrink-0 cursor-grab text-copy-muted" aria-hidden="true" />
                            {href ? (
                              <Link href={href} className="line-clamp-2 min-w-0 flex-1 rounded-[var(--radius-control-sm)] text-sm font-medium text-copy-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                                {itemLabel}
                              </Link>
                            ) : (
                              <button
                                type="button"
                                className="line-clamp-2 min-w-0 flex-1 rounded-[var(--radius-control-sm)] text-left text-sm font-medium text-copy-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                                onClick={() => onOpenItem?.(item)}
                              >
                                {itemLabel}
                              </button>
                            )}
                          </div>
                          <div className="mt-2 space-y-1 pl-6 text-xs text-copy-muted">{renderCardBody(item)}</div>
                          <Select
                            value={moveOptions.some((option) => option.key === current) ? current : undefined}
                            onValueChange={(value) => move(item, value, true)}
                          >
                            <SelectTrigger
                              data-board-move=""
                              className="mt-3 w-full"
                              aria-label={`Change ${moveFieldLabel} for ${itemLabel}`}
                            >
                              <SelectValue placeholder={`Choose ${moveFieldLabel}`} />
                            </SelectTrigger>
                            <SelectContent>
                              {moveOptions.map((option) => (
                                <SelectItem key={option.key} value={option.key}>{option.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </li>
                      );
                    })
                  ) : (
                    <li className="px-2 py-6 text-center text-sm text-copy-muted">No {itemsLabel}</li>
                  )}
                </ol>
              </section>
            );
          })}
        </div>
      )}
    </ModuleTableShell>
  );
}
