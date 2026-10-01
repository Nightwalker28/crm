"use client";

import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cva } from "class-variance-authority";
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
  TableGroupCell,
  TableGroupRow,
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
  /**
   * A row the bulk action cannot legally apply to — the signed-in user in the user
   * list, say. Its checkbox is drawn disabled rather than omitted, so the column keeps
   * its rhythm, and "select all" skips it instead of selecting something the caller
   * would have to filter back out.
   */
  isRowSelectable?: (row: T) => boolean;
};

type StateSlot = {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
};

const recordTableRowVariants = cva("group", {
  variants: {
    // A row that cannot be opened must not light up under the pointer. The hover tint is
    // an affordance, and `readOnly` / `lineItems` rows have nothing behind them to reach.
    quiet: { true: "hover:bg-transparent", false: "" },
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
  defaultVariants: { quiet: false, interactive: false, highlighted: false },
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
    // The editable grid is a form, not a list: every cell holds a control, so the list's
    // own `px-4` would put more gutter between two inputs than the form around it puts
    // between two fields (design.md 4.4).
    variant: { default: "", readOnly: "", lineItems: "px-2 py-2" },
  },
  defaultVariants: { align: "left", selection: false, variant: "default" },
});

const recordTableHeadVariants = cva("", {
  variants: {
    align: { left: "", right: "text-right" },
    selection: { true: "w-12", false: "" },
    variant: { default: "", readOnly: "", lineItems: "px-2" },
  },
  defaultVariants: { align: "left", selection: false, variant: "default" },
});

export type RecordTableVariant = "default" | "lineItems" | "readOnly";

/**
 * `interactive`, `highlighted` and `quiet` are computed here from `variant` and the
 * gesture props, so the row `cva` is deliberately *not* intersected into the public
 * props: a call site that could pass `highlighted` would be styling a row without
 * telling the table why.
 */
type RecordTableBaseProps<T> = {
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
  /**
   * Bands the rows. Returns the band's label; a band opens wherever the label changes,
   * so the caller supplies the rows already in group order — the table does not reorder
   * them. Grouping is a presentation of the sort, not a second one.
   */
  groupBy?: (row: T) => string;
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
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
  filteredEmptyState?: Partial<StateSlot>;

  /** `nested` when the table sits inside a `Card` that already draws the panel edge. */
  shellVariant?: "standalone" | "nested";
  className?: string;
};

/**
 * `emptyState` is required on the two variants that show a list, and optional on the one
 * that shows a form. §7.4 makes the empty state mandatory precisely because every page
 * that *could* omit it did, so the union keeps the floor rather than handing every caller
 * a default that says "No rows".
 */
type RecordTableProps<T> = RecordTableBaseProps<T> &
  (
    | { variant?: "default" | "readOnly"; emptyState: StateSlot }
    | { variant: "lineItems"; emptyState?: StateSlot }
  );

function isInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest("a, button, input, select, textarea, label, [role='checkbox'], [role='switch'], [data-no-row-open]"),
  );
}

export function RecordTable<T>({
  variant = "default",
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
  groupBy,
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

  // The variant is a contract, not a suggestion (design.md 7.10). A `readOnly` table
  // handed a `selection` draws no checkboxes rather than quietly becoming a list, so the
  // wrong variant is visible immediately instead of shipping as a subtle difference.
  const isList = variant === "default";
  const hasSelection = isList && Boolean(selection);
  const hasRowActions = Boolean(rowActions);
  const columnCount = columns.length + (hasSelection ? 1 : 0) + (hasRowActions ? 1 : 0);
  const canOpenRow = isList && Boolean(onOpenRow || rowHref);
  const canSort = isList && Boolean(onSortChange);

  const minWidth =
    columns.reduce((total, column) => total + COLUMN_WIDTH[column.size ?? "md"], 0) +
    (hasSelection ? SELECTION_COLUMN_WIDTH : 0) +
    (hasRowActions ? ACTIONS_COLUMN_WIDTH : 0);

  const selectedIds = selection?.selectedIds ?? [];
  const selectableRows = selection?.isRowSelectable ? rows.filter(selection.isRowSelectable) : rows;
  const pageIds = selectableRows.map(rowKey);
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

  /**
   * The three states that draw a centred box, and why they are **not** a `td colSpan`.
   *
   * The table carries a derived `min-width`, so wherever it is wider than the region it
   * scrolls inside, a `colSpan` cell is laid out across `scrollWidth`, not the visible
   * width — measured on the contact record's Files tab at `clientWidth 580 /
   * scrollWidth 920`, where the empty state was an 888px box starting at `left: 662` and
   * running past the visible right edge. It was invisible on a full-width list, where the
   * two widths are equal, and read as merely off-centre wherever the copy was short.
   *
   * A block sibling of the table takes the scroll container's *content* width instead —
   * the visible one — and `sticky left-0` keeps it there while the columns scroll under
   * it. `scroll-containers.spec.ts` was always right about this: the region is a
   * legitimate scroller, and the bug was the empty state participating in its width.
   *
   * Loading stays inside the table, because skeleton rows are column-shaped and *should*
   * span the columns they stand in for.
   */
  function renderState() {
    // The 7.4 states, in the order the operator can act on them: no access at all, then
    // failed, then arrived empty. Loading is handled in the body.
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
          icon: filteredEmptyState?.icon ?? emptyState?.icon,
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
      : emptyState ?? { title: `No ${label.toLocaleLowerCase()} yet` };

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
      return <ModuleTableLoading columnCount={columnCount} withCheckbox={hasSelection} />;
    }

    if (state) return null;

    let openBand: string | null = null;

    return rows.map((row) => {
      const id = rowKey(row);
      const detail = rowDetail?.(row) ?? null;
      const href = rowHref?.(row);
      // A band opens where the label changes. Tracking the previous label beats grouping
      // into a nested array, because the row rendering below stays one code path — the
      // grouped list and the flat one cannot drift apart if there is only one of them.
      const band = groupBy?.(row) ?? null;
      const opensBand = band !== null && band !== openBand;
      if (opensBand) openBand = band;
      return (
        <Fragment key={id}>
          {opensBand ? (
            <TableGroupRow>
              <TableGroupCell colSpan={columnCount}>{band}</TableGroupCell>
            </TableGroupRow>
          ) : null}
          <TableRow
            className={recordTableRowVariants({
              quiet: !canOpenRow,
              interactive: canOpenRow,
              highlighted: isRowHighlighted?.(row) ?? false,
            })}
            {...(canOpenRow
              ? {
                  tabIndex: 0,
                  "aria-label": rowLabel?.(row),
                  onClick: (event: React.MouseEvent<HTMLTableRowElement>) => {
                    // A modified click belongs to the identity link, which opens a new
                    // tab natively. Swallowing it here beats navigating in place.
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    // React bubbles through portals, so a click on a row action's menu item
                    // reaches this handler although the item is not in the row's DOM. A click
                    // that did not start inside the row is never the row's.
                    if (!event.currentTarget.contains(event.target as Node)) return;
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
              <TableCell className={recordTableCellVariants({ selection: true, variant })}>
                <Checkbox
                  disabled={selection.isRowSelectable ? !selection.isRowSelectable(row) : false}
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
                    recordTableCellVariants({ align: column.align ?? "left", variant }),
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
              <TableCell className={recordTableCellVariants({ align: "right", variant })} data-no-row-open="">
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
    <ModuleTableShell isRefreshing={isRefreshing} isLoading={isLoading} label={label} variant={shellVariant} className={className}>
      <Table data-variant={variant} style={{ minWidth: `${minWidth}px` }}>
        <TableHeader>
          <TableHeaderRow>
            {selection ? (
              <TableHead className={recordTableHeadVariants({ selection: true, variant })}>
                <Checkbox
                  checked={headerSelectionState}
                  onCheckedChange={(checked) => selection.onToggleAll(checked === true)}
                  aria-label={selection.allLabel ?? `Select all ${label.toLocaleLowerCase()} on this page`}
                />
              </TableHead>
            ) : null}
            {columns.map((column) => {
              const headClassName = recordTableHeadVariants({ align: column.align ?? "left", variant });
              return column.sortable && canSort ? (
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
              <TableHead className={recordTableHeadVariants({ align: "right", variant })}>{rowActionsLabel}</TableHead>
            ) : null}
          </TableHeaderRow>
        </TableHeader>
        <TableBody>{renderBody()}</TableBody>
      </Table>
      {state ? (
        // `sticky left-0` against the scroll container, `w-full` against its *content*
        // box — so this box is the visible width and stays at the visible left edge no
        // matter how far the columns have been scrolled. See `renderState`.
        <div
          data-slot="record-table-state"
          className="sticky left-0 w-full border-t border-line-subtle py-12"
          {...(state.alert ? { role: "alert" } : {})}
        >
          {state.content}
        </div>
      ) : null}
    </ModuleTableShell>
  );
}

export { recordTableCellVariants, recordTableHeadVariants, recordTableRowVariants };
