"use client";

import { Fragment, type ReactNode } from "react";
import { Inbox, ShieldX, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/EmptyState";
import { ModuleTableLoading } from "@/components/ui/ModuleTableLoading";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import {
  Table,
  TableBody,
  TableCell,
  TableGroupCell,
  TableGroupRow,
  TableHead,
  TableHeader,
  TableHeaderRow,
  TableRow,
} from "@/components/ui/Table";
import { cn } from "@/lib/utils";

/**
 * The matrix: records down, actions across, a control in every cell.
 *
 * `RecordTable`'s sibling, not its variant, and design.md §7.10 carries the reasoning.
 * The short version is that a matrix cell cannot be read on its own — scroll the module
 * name off to the left and thirty rows of anonymous checkboxes say nothing — so the
 * identity column has to pin, which is precisely the mechanism `RecordTable` removed
 * after it produced two measured defects. Rather than put a conditional sticky column
 * back into the list primitive for one consumer, the shape that needs it gets its own
 * primitive and solves it once, here.
 *
 * What it owns:
 *
 * - **The pinned identity column**, in both the header and the body, with the z-ladder
 *   and the ground inheritance that make pinning actually work (see below).
 * - **A header cell that carries a control.** A `RecordTable` head is a label and
 *   optionally a sort button; a matrix head sets its whole column, tri-state.
 * - **The row control**, which sets every action on one record. It is not selection: it
 *   writes the same draft the cells do.
 * - **Group bands**, and all four §7.4 states.
 *
 * What it deliberately drops: the row-open gesture (there is nothing behind a row), the
 * selection column, sort (the row order *is* the grouping), and pagination. A matrix that
 * wants any of those is a list, and lists are `RecordTable`'s.
 */

export type MatrixRowId = number | string;

/**
 * Width hints feeding the derived min-width, matching `RecordTable`'s intent: the table
 * is `table-auto`, so these decide when a horizontal scrollbar appears, not the rendered
 * widths. The identity column is wide because it carries a name and a description; an
 * action column holds one centred checkbox under a short verb.
 */
const IDENTITY_COLUMN_WIDTH = 256;
const ACTION_COLUMN_WIDTH = 96;

export type MatrixColumn<T> = {
  key: string;
  /** The action's verb. Short — it sits over a checkbox in a 96px column. */
  label: string;
  /** Long form, shown natively on hover. */
  title?: string;
  value: (row: T) => boolean;
  onToggle: (row: T, checked: boolean) => void;
};

/** One band of rows. A matrix with no grouping passes a single group with no label. */
export type MatrixGroup<T> = {
  key: string;
  label?: string;
  rows: T[];
};

type StateSlot = {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
};

type MatrixTableProps<T> = {
  columns: MatrixColumn<T>[];
  groups: MatrixGroup<T>[];
  rowKey: (row: T) => MatrixRowId;
  /** Names the scroll region — "Role permissions". Not a sentence. */
  label: string;
  /** Header of the pinned column. */
  identityLabel: string;
  renderIdentity: (row: T) => ReactNode;

  /** Sets every action on one record. Omit and the row control is not drawn. */
  onToggleRow?: (row: T, checked: boolean) => void;
  /** Sets one action across every row currently rendered. Omit and the header is a label. */
  onToggleColumn?: (column: MatrixColumn<T>, checked: boolean) => void;

  /** Accessible names. The grid is nothing but checkboxes, so these are not optional. */
  rowToggleLabel: (row: T) => string;
  cellLabel: (row: T, column: MatrixColumn<T>) => string;
  columnToggleLabel?: (column: MatrixColumn<T>) => string;

  /** Every control in the grid goes flat while a save is in flight. */
  disabled?: boolean;

  isLoading?: boolean;
  isRefreshing?: boolean;
  isPermissionDenied?: boolean;
  hasError?: boolean;
  onRetry?: () => void;
  errorState?: Partial<StateSlot>;
  permissionDeniedState?: Partial<StateSlot>;
  emptyState: StateSlot;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
  filteredEmptyState?: Partial<StateSlot>;

  shellVariant?: "standalone" | "nested";
  className?: string;
};

/**
 * The z-ladder, which is the whole reason this pins correctly and the page it replaced
 * did not.
 *
 * `thead` is `sticky top-0 z-20` and, being positioned with a z-index, opens a stacking
 * context — so a z-index written on a `th` is scoped *inside* the header and never
 * compared against the body. `tbody` opens no such context, so anything positioned in a
 * body cell is compared against `thead`'s own 20. That is how `RecordTable`'s pinned
 * checkbox came to paint over the header: equal z-index resolves by DOM order, and the
 * body is later.
 *
 * So the ladder is strict, and every rung is below the header's 20:
 *
 *   thead (20)  >  group band (10)  >  pinned identity cell (0)  >  ordinary cells (auto)
 *
 * The pinned cell only has to beat the unpositioned cells scrolling under it, which any
 * positioned element does, so it takes the *bottom* rung rather than competing upward.
 * The group band sits above it because a band the identity column slides over instead of
 * under is the same defect one axis rotated.
 */
const PINNED_HEAD = "sticky left-0 z-10 bg-surface-raised";
const PINNED_CELL = "sticky left-0 z-0 bg-inherit";
const GROUP_BAND = "z-10";

export function MatrixTable<T>({
  columns,
  groups,
  rowKey,
  label,
  identityLabel,
  renderIdentity,
  onToggleRow,
  onToggleColumn,
  rowToggleLabel,
  cellLabel,
  columnToggleLabel,
  disabled = false,
  isLoading = false,
  isRefreshing = false,
  isPermissionDenied = false,
  hasError = false,
  onRetry,
  errorState,
  permissionDeniedState,
  emptyState,
  hasActiveFilters = false,
  onClearFilters,
  filteredEmptyState,
  shellVariant,
  className,
}: MatrixTableProps<T>) {
  const rows = groups.flatMap((group) => group.rows);
  const columnCount = columns.length + 1;
  const minWidth = IDENTITY_COLUMN_WIDTH + columns.length * ACTION_COLUMN_WIDTH;

  /** Tri-state, shared by the row control and the column control. */
  function toggleState(values: boolean[]): boolean | "indeterminate" {
    if (!values.length || values.every((value) => !value)) return false;
    if (values.every(Boolean)) return true;
    return "indeterminate";
  }

  // Identical in shape to `RecordTable.renderState`, and for the identical reason: the
  // three centred states are a block sibling of the table, never a `colSpan` cell. A
  // `colSpan` is laid out across `scrollWidth`, so on a table wide enough to scroll —
  // which a matrix always is — the box starts past the visible right edge. Loading stays
  // inside the table, because skeleton rows are column-shaped.
  function renderState() {
    if (isPermissionDenied) {
      return {
        alert: true,
        content: (
          <EmptyState
            icon={permissionDeniedState?.icon ?? ShieldX}
            title={permissionDeniedState?.title ?? `You do not have access to ${label.toLocaleLowerCase()}`}
            description={
              permissionDeniedState?.description ?? "Ask an administrator for the required module or action access."
            }
            action={permissionDeniedState?.action}
          />
        ),
      };
    }

    if (isLoading) return null;

    if (hasError) {
      return {
        alert: true,
        content: (
          <EmptyState
            icon={errorState?.icon ?? TriangleAlert}
            title={errorState?.title ?? `${label} could not be loaded`}
            description={errorState?.description ?? "Check your connection and try again."}
            action={
              errorState?.action ??
              (onRetry ? (
                <Button type="button" variant="outline" onClick={onRetry}>
                  Try again
                </Button>
              ) : undefined)
            }
          />
        ),
      };
    }

    if (rows.length) return null;

    const slot: StateSlot = hasActiveFilters
      ? {
          icon: filteredEmptyState?.icon ?? emptyState.icon,
          title: filteredEmptyState?.title ?? `No ${label.toLocaleLowerCase()} match these filters`,
          description: filteredEmptyState?.description ?? "Clear one or more filters and try again.",
          action:
            filteredEmptyState?.action ??
            (onClearFilters ? (
              <Button type="button" variant="outline" onClick={onClearFilters}>
                Clear filters
              </Button>
            ) : undefined),
        }
      : emptyState;

    return {
      alert: false,
      content: (
        <EmptyState icon={slot.icon ?? Inbox} title={slot.title} description={slot.description} action={slot.action} />
      ),
    };
  }

  const state = renderState();

  function renderBody() {
    if (isLoading && !isPermissionDenied) {
      return <ModuleTableLoading columnCount={columnCount} withCheckbox={false} />;
    }

    if (state) return null;

    return groups.map((group) => (
      <Fragment key={group.key}>
        {group.label ? (
          <TableGroupRow className={GROUP_BAND}>
            <TableGroupCell colSpan={columnCount}>{group.label}</TableGroupCell>
          </TableGroupRow>
        ) : null}
        {group.rows.map((row) => {
          const values = columns.map((column) => column.value(row));
          return (
            // `bg-inherit` on the pinned cell, not a named ground. The row carries the
            // stripe (`odd:bg-surface` / `even:bg-surface-row-alt`) and the hover tint,
            // and a pinned cell has to occlude the columns passing beneath it — so it
            // needs an opaque ground of its own that is *the row's*. The page this
            // replaced hardcoded `bg-surface`, which is the odd row's: every even row's
            // pinned cell drew the wrong stripe, and the hover tint stopped at its edge.
            <TableRow key={rowKey(row)}>
              <TableCell className={cn(PINNED_CELL, "border-r border-line-subtle")}>
                <div className="flex items-start gap-3">
                  {onToggleRow ? (
                    <Checkbox
                      className="mt-0.5 shrink-0"
                      aria-label={rowToggleLabel(row)}
                      checked={toggleState(values)}
                      disabled={disabled}
                      onCheckedChange={(checked) => onToggleRow(row, checked === true)}
                    />
                  ) : null}
                  <div className="min-w-0">{renderIdentity(row)}</div>
                </div>
              </TableCell>
              {columns.map((column) => (
                <TableCell key={column.key} className="text-center">
                  <Checkbox
                    className="mx-auto"
                    aria-label={cellLabel(row, column)}
                    checked={column.value(row)}
                    disabled={disabled}
                    onCheckedChange={(checked) => column.onToggle(row, checked === true)}
                  />
                </TableCell>
              ))}
            </TableRow>
          );
        })}
      </Fragment>
    ));
  }

  return (
    <ModuleTableShell isRefreshing={isRefreshing} label={label} variant={shellVariant} className={className}>
      <Table style={{ minWidth: `${minWidth}px` }}>
        <TableHeader>
          <TableHeaderRow>
            <TableHead className={cn(PINNED_HEAD, "border-r border-line-subtle")}>{identityLabel}</TableHead>
            {columns.map((column) => {
              const columnValues = rows.map((row) => column.value(row));
              return (
                <TableHead key={column.key} title={column.title} className="text-center">
                  {/* The control sits beside its label, not above it. A stacked header is
                      taller than `TableGroupRow`'s sticky offset, which is what forced the
                      page this replaced to hand-tune that offset to a pixel. */}
                  <span className="inline-flex items-center gap-2">
                    {onToggleColumn ? (
                      <Checkbox
                        aria-label={
                          columnToggleLabel?.(column) ?? `Set ${column.label.toLocaleLowerCase()} for every row`
                        }
                        checked={toggleState(columnValues)}
                        disabled={disabled || !rows.length}
                        onCheckedChange={(checked) => onToggleColumn(column, checked === true)}
                      />
                    ) : null}
                    {column.label}
                  </span>
                </TableHead>
              );
            })}
          </TableHeaderRow>
        </TableHeader>
        <TableBody>{renderBody()}</TableBody>
      </Table>
      {state ? (
        <div
          data-slot="matrix-table-state"
          className="sticky left-0 w-full border-t border-line-subtle py-12"
          {...(state.alert ? { role: "alert" } : {})}
        >
          {state.content}
        </div>
      ) : null}
    </ModuleTableShell>
  );
}
