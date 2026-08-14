"use client";

import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cva, type VariantProps } from "class-variance-authority";
import { Inbox, ShieldX, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/EmptyState";
import { ModuleTableLoading } from "@/components/ui/ModuleTableLoading";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import {
  SortableHead,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableHeaderRow,
  TableRow,
} from "@/components/ui/Table";
import { cn } from "@/lib/utils";

/**
 * The module list table.
 *
 * `Table` is a *cell* primitive: it owns padding, stripes, the sticky header and the
 * sort affordance, and it does that well. Everything above the cell had no owner, so
 * thirteen modules hand-assembled it and drifted — nine hardcoded `min-w-[Npx]` values,
 * three selection markups, four row-open gestures, and three empty states that shipped
 * no create action. `RecordTable` owns that layer (design.md 4.4).
 *
 * What it owns, and why each one is here rather than at the call site:
 *
 * - **Min-width derived from the visible columns.** A hardcoded width is wrong as soon
 *   as the operator trims the view: three columns still forced a 1160px scrollbar.
 * - **The selection column** — one width, one padding, and tri-state `indeterminate`
 *   computed here, so a partial page selection can no longer read as an empty checkbox on
 *   one list and a dash on another.
 * - **One row-open gesture**, bound to click, Enter and Space, with a focus ring the
 *   operator can see. Keyboard reach is a section 8 floor, and a row that takes focus
 *   invisibly is worse than the mouse-only row it replaces.
 * - **All four section 7.4 data-view states.** When each page had to remember them, most
 *   did not.
 *
 * Legitimate differences between lists are variants here (section 7.3), never a
 * `className` at the call site.
 */

export type RecordRowId = number | string;

export type RecordTableSort = { column: string; direction: "asc" | "desc" };

/**
 * Width hints, in px, that feed the derived table min-width. They are deliberately
 * coarse: the table is `table-auto`, so these only decide when a horizontal scrollbar
 * appears, not the rendered column widths.
 */
const COLUMN_WIDTH = { sm: 96, md: 132, lg: 220 } as const;
const SELECTION_COLUMN_WIDTH = 48;
const ACTIONS_COLUMN_WIDTH = 112;

export type RecordTableColumn<T> = {
  key: string;
  label: ReactNode;
  /** Renders the cell's content. The primitive supplies the `td`. */
  render: (row: T) => ReactNode;
  sortable?: boolean;
  align?: "left" | "right";
  /** Width hint for the derived min-width. Defaults to `md`. */
  size?: keyof typeof COLUMN_WIDTH;
  /** Set when the cell carries its own controls, so a click there never opens the row. */
  interactive?: boolean;
  className?: string;
};

export type RecordTableSelection<T> = {
  selectedIds: RecordRowId[];
  onToggleRow: (id: RecordRowId, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  /** Accessible name for a row's checkbox — say which record it selects. */
  rowLabel?: (row: T) => string;
  /** Accessible name for the header checkbox. */
  allLabel?: string;
};

type StateSlot = {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
};

const recordTableRowVariants = cva("group", {
  variants: {
    interactive: {
      // The ring is drawn as an outline: a table row in a `border-collapse` table does
      // not paint a box-shadow reliably, and an invisible focus point is the one
      // outcome worse than no keyboard gesture at all (2.3).
      true: "cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
      false: "",
    },
    // A deep link landing on one row. It is not focus, so it must not borrow the
    // action colour that a focus ring is forbidden from using either (2.3).
    highlighted: { true: "bg-action-primary-muted ring-1 ring-inset ring-line-strong", false: "" },
  },
  defaultVariants: { interactive: false, highlighted: false },
});

/**
 * No horizontally-sticky columns. The selection and identity columns used to pin, and
 * two things came out of it that were worse than the scroll they saved:
 *
 * - The row's checkbox painted **over** the header's. `thead` is `sticky top-0 z-20`, and
 *   a positioned element with a z-index opens a stacking context — so the header cell's
 *   own z-index was scoped inside `thead` and never compared against the body. `tbody`
 *   opens no such context, so the body cell's `z-20` met the header's `z-20` as equals,
 *   and equal z-index is resolved by DOM order, which the body wins.
 * - The selection cell carried `pr-0` to stay narrow. `table-auto` collapses a column to
 *   its content when the table is short of width, so at a narrow viewport the right-hand
 *   border closed onto the checkbox with no gap, while a wide viewport had slack and
 *   looked correct.
 *
 * Both disappear with the pinning: an unpositioned cell always paints under the sticky
 * header, and the column takes the table's own `px-4` on both sides — 16 + 16 + 16 = the
 * 48px this file already budgets for it.
 */
const recordTableCellVariants = cva("", {
  variants: {
    align: { left: "", right: "text-right" },
    selection: { true: "w-12", false: "" },
  },
  defaultVariants: { align: "left", selection: false },
});

const recordTableHeadVariants = cva("", {
  variants: {
    align: { left: "", right: "text-right" },
    selection: { true: "w-12", false: "" },
  },
  defaultVariants: { align: "left", selection: false },
});

type RecordTableProps<T> = VariantProps<typeof recordTableRowVariants> & {
  columns: RecordTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => RecordRowId;
  /** Names the scroll region — "Leads", "Invoices". Not a sentence. */
  label: string;

  /** The row-open gesture. Give one or both; `rowHref` also makes the identity cell a link. */
  onOpenRow?: (row: T) => void;
  rowHref?: (row: T) => string;
  /** Accessible name for the focusable row. */
  rowLabel?: (row: T) => string;

  selection?: RecordTableSelection<T>;
  rowActions?: (row: T) => ReactNode;
  rowActionsLabel?: string;
  /** An expanded panel under the row. Return null when the row is collapsed. */
  rowDetail?: (row: T) => ReactNode | null;
  /** Marks the row a deep link landed on. */
  isRowHighlighted?: (row: T) => boolean;

  sort?: RecordTableSort | null;
  onSortChange?: (sort: RecordTableSort) => void;

  isLoading?: boolean;
  isRefreshing?: boolean;
  /** 7.4 — the three states a success-only view is missing. */
  isPermissionDenied?: boolean;
  hasError?: boolean;
  onRetry?: () => void;
  errorState?: Partial<StateSlot>;
  permissionDeniedState?: Partial<StateSlot>;
  emptyState: StateSlot;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
  filteredEmptyState?: Partial<StateSlot>;

  /** `nested` when the table sits inside a `Card` that already draws the panel edge. */
  shellVariant?: "standalone" | "nested";
  className?: string;
};

function isInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest("a, button, input, select, textarea, label, [role='checkbox'], [role='switch'], [data-no-row-open]"),
  );
}

export function RecordTable<T>({
  columns,
  rows,
  rowKey,
  label,
  onOpenRow,
  rowHref,
  rowLabel,
  selection,
  rowActions,
  rowActionsLabel = "Actions",
  rowDetail,
  isRowHighlighted,
  sort = null,
  onSortChange,
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
}: RecordTableProps<T>) {
  const router = useRouter();

  const hasSelection = Boolean(selection);
  const hasRowActions = Boolean(rowActions);
  const columnCount = columns.length + (hasSelection ? 1 : 0) + (hasRowActions ? 1 : 0);
  const canOpenRow = Boolean(onOpenRow || rowHref);

  const minWidth =
    columns.reduce((total, column) => total + COLUMN_WIDTH[column.size ?? "md"], 0) +
    (hasSelection ? SELECTION_COLUMN_WIDTH : 0) +
    (hasRowActions ? ACTIONS_COLUMN_WIDTH : 0);

  const selectedIds = selection?.selectedIds ?? [];
  const pageIds = rows.map(rowKey);
  const selectedOnPage = pageIds.filter((id) => selectedIds.includes(id)).length;
  const headerSelectionState: boolean | "indeterminate" =
    !selectedOnPage ? false : selectedOnPage === pageIds.length ? true : "indeterminate";

  function toggleSort(column: string) {
    onSortChange?.(
      sort?.column === column
        ? { column, direction: sort.direction === "asc" ? "desc" : "asc" }
        : { column, direction: "asc" },
    );
  }

  function openRow(row: T) {
    if (onOpenRow) {
      onOpenRow(row);
      return;
    }
    if (rowHref) router.push(rowHref(row));
  }

  function renderStateRow(content: ReactNode, alert = false) {
    return (
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={columnCount} className="py-12" {...(alert ? { role: "alert" } : {})}>
          {content}
        </TableCell>
      </TableRow>
    );
  }

  function renderBody() {
    // The four 7.4 states, in the order the operator can act on them: no access at all,
    // then still arriving, then failed, then arrived empty.
    if (isPermissionDenied) {
      return renderStateRow(
        <EmptyState
          icon={permissionDeniedState?.icon ?? ShieldX}
          title={permissionDeniedState?.title ?? `You do not have access to ${label.toLocaleLowerCase()}`}
          description={
            permissionDeniedState?.description ?? "Ask an administrator for the required module or action access."
          }
          action={permissionDeniedState?.action}
        />,
        true,
      );
    }

    if (isLoading) {
      return <ModuleTableLoading columnCount={columnCount} withCheckbox={hasSelection} />;
    }

    if (hasError) {
      return renderStateRow(
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
        />,
        true,
      );
    }

    if (!rows.length) {
      const filtered = hasActiveFilters;
      const slot: StateSlot = filtered
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
      return renderStateRow(
        <EmptyState icon={slot.icon ?? Inbox} title={slot.title} description={slot.description} action={slot.action} />,
      );
    }

    return rows.map((row) => {
      const id = rowKey(row);
      const detail = rowDetail?.(row) ?? null;
      const href = rowHref?.(row);
      return (
        <Fragment key={id}>
          <TableRow
            className={recordTableRowVariants({ interactive: canOpenRow, highlighted: isRowHighlighted?.(row) ?? false })}
            {...(canOpenRow
              ? {
                  tabIndex: 0,
                  "aria-label": rowLabel?.(row),
                  onClick: (event: React.MouseEvent<HTMLTableRowElement>) => {
                    // A modified click belongs to the identity link, which opens a new
                    // tab natively. Swallowing it here beats navigating in place.
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    if (isInteractiveTarget(event.target)) return;
                    openRow(row);
                  },
                  onKeyDown: (event: React.KeyboardEvent<HTMLTableRowElement>) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    openRow(row);
                  },
                }
              : {})}
          >
            {selection ? (
              <TableCell className={recordTableCellVariants({ selection: true })}>
                <Checkbox
                  checked={selectedIds.includes(id)}
                  onCheckedChange={(checked) => selection.onToggleRow(id, checked === true)}
                  aria-label={selection.rowLabel?.(row) ?? `Select ${label.toLocaleLowerCase()} row`}
                />
              </TableCell>
            ) : null}
            {columns.map((column, index) => {
              const isIdentity = index === 0;
              const content = column.render(row);
              return (
                <TableCell
                  key={column.key}
                  className={cn(
                    recordTableCellVariants({ align: column.align ?? "left" }),
                    column.className,
                  )}
                  {...(column.interactive ? { "data-no-row-open": "" } : {})}
                >
                  {/* Never wrap a cell that holds its own link — the visible columns are
                      operator-ordered, so any column can end up first. */}
                  {isIdentity && href && !column.interactive ? (
                    // A real link, so the row can still be opened in a new tab or copied,
                    // but never a second tab stop: the row is the gesture.
                    <Link
                      href={href}
                      tabIndex={-1}
                      className="block min-w-0 rounded-[var(--radius-control-sm)] focus-visible:outline-none"
                    >
                      {content}
                    </Link>
                  ) : (
                    content
                  )}
                </TableCell>
              );
            })}
            {rowActions ? (
              <TableCell className={recordTableCellVariants({ align: "right" })} data-no-row-open="">
                {rowActions(row)}
              </TableCell>
            ) : null}
          </TableRow>
          {detail ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columnCount} className="bg-surface-muted/50">
                {detail}
              </TableCell>
            </TableRow>
          ) : null}
        </Fragment>
      );
    });
  }

  return (
    <ModuleTableShell isRefreshing={isRefreshing} label={label} variant={shellVariant} className={className}>
      <Table style={{ minWidth: `${minWidth}px` }}>
        <TableHeader>
          <TableHeaderRow>
            {selection ? (
              <TableHead className={recordTableHeadVariants({ selection: true })}>
                <Checkbox
                  checked={headerSelectionState}
                  onCheckedChange={(checked) => selection.onToggleAll(checked === true)}
                  aria-label={selection.allLabel ?? `Select all ${label.toLocaleLowerCase()} on this page`}
                />
              </TableHead>
            ) : null}
            {columns.map((column) => {
              const headClassName = recordTableHeadVariants({ align: column.align ?? "left" });
              return column.sortable && onSortChange ? (
                <SortableHead
                  key={column.key}
                  sorted={sort?.column === column.key}
                  direction={sort?.column === column.key ? sort.direction : "asc"}
                  onClick={() => toggleSort(column.key)}
                  className={headClassName}
                >
                  {column.label}
                </SortableHead>
              ) : (
                <TableHead key={column.key} className={headClassName}>
                  {column.label}
                </TableHead>
              );
            })}
            {rowActions ? (
              <TableHead className={recordTableHeadVariants({ align: "right" })}>{rowActionsLabel}</TableHead>
            ) : null}
          </TableHeaderRow>
        </TableHeader>
        <TableBody>{renderBody()}</TableBody>
      </Table>
    </ModuleTableShell>
  );
}

export { recordTableCellVariants, recordTableRowVariants };
