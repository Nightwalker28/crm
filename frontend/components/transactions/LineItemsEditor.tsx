"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { ArrowDown, ArrowUp, Copy, MoreHorizontal, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { RecordTable, type RecordTableColumn } from "@/components/ui/RecordTable";

/**
 * What a column's cell gets besides its line: where it is, and the props that make an input
 * part of the grid's keyboard walk.
 */
export type LineCellContext = {
  index: number;
  /** Spread on the cell's input: Enter moves to the same field on the next line (13a E8). */
  cellProps: (field: string) => {
    "data-line-editor": string;
    "data-line-row": number;
    "data-line-field": string;
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  };
};

export type LineItemsColumn<Line> = Omit<RecordTableColumn<Line>, "render"> & {
  render: (line: Line, context: LineCellContext) => ReactNode;
};

/**
 * The one editable line grid (13a E8). Quotes, orders and invoices, purchase orders, bills,
 * adjustments and transfers each had their own, so Enter, add, remove and the error differed
 * from one document to the next. Each document now names only its columns; the grid, its
 * keyboard walk and its layout (§7.10 `lineItems`, 13a H15) are this one component.
 *
 * - Enter in a cell moves to the same field on the next line; on the last line it adds one
 *   (when lines can be added) and moves there.
 * - The remove button is there unless the document's lines are fixed, and is disabled on the
 *   last remaining line.
 */
export function LineItemsEditor<Line>({
  id,
  label,
  lines,
  lineKey,
  columns,
  onChange,
  createLine,
  addLabel = "Add line",
  lineLabel,
  error,
  footer,
}: {
  /** Distinguishes this grid's cells from another grid's on the same page. */
  id: string;
  /** Names the grid — "Line items", "Purchase order lines". */
  label: string;
  lines: Line[];
  lineKey: (line: Line) => string | number;
  columns: LineItemsColumn<Line>[];
  onChange: (lines: Line[]) => void;
  /** A blank line. Omitted when the document's lines are fixed (taken from an order, say). */
  createLine?: () => Line;
  addLabel?: string;
  /** How the remove button names a line: "Remove Camera". */
  lineLabel: (line: Line, index: number) => string;
  error?: string | null;
  /** Under the grid, beside the add button: totals. */
  footer?: ReactNode;
  /** Beside the add button: more kinds of line, e.g. *Add section* (13d §3.2). */
  extraAddActions?: ReactNode;
  /** A row menu with *Move up* and *Move down* (13d §3.2, D10). */
  reorderable?: boolean;
  /** A copy of the line, for the row menu's *Duplicate*. */
  duplicateLine?: (line: Line) => Line;
}) {
  function focusCell(index: number, field: string) {
    document.querySelector<HTMLInputElement>(`[data-line-editor="${id}"][data-line-row="${index}"][data-line-field="${field}"]`)?.focus();
  }

  function addLine(focusField?: string) {
    if (!createLine) return;
    const nextIndex = lines.length;
    onChange([...lines, createLine()]);
    requestAnimationFrame(() => focusCell(nextIndex, focusField ?? String(columns[0]?.key ?? "")));
  }

  function context(index: number): LineCellContext {
    return {
      index,
      cellProps: (field: string) => ({
        "data-line-editor": id,
        "data-line-row": index,
        "data-line-field": field,
        onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key !== "Enter" || event.defaultPrevented) return;
          event.preventDefault();
          if (index < lines.length - 1) focusCell(index + 1, field);
          else addLine(field);
        },
      }),
    };
  }

  const tableColumns: RecordTableColumn<Line>[] = columns.map((column) => ({
    ...column,
    render: (line: Line) => column.render(line, context(lines.indexOf(line))),
  }));

  return (
    <div className="flex flex-col gap-3">
      <RecordTable
        variant="lineItems"
        shellVariant="nested"
        label={label}
        columns={tableColumns}
        rows={lines}
        rowKey={lineKey}
        rowActionsLabel={reorderable || duplicateLine ? "Actions" : "Remove"}
        rowActions={createLine ? (line) => {
          const index = lines.indexOf(line);
          const remove = (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove ${lineLabel(line, index)}`}
              disabled={lines.length === 1}
              onClick={() => onChange(lines.filter((candidate) => lineKey(candidate) !== lineKey(line)))}
            >
              <Trash2 />
            </Button>
          );
          if (!reorderable && !duplicateLine) return remove;
          return (
            <div className="flex items-center justify-end gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" aria-label={`More for ${lineLabel(line, index)}`}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {reorderable ? (
                    <>
                      <DropdownMenuItem disabled={index === 0} onSelect={() => onChange(move(lines, index, index - 1))}><ArrowUp />Move up</DropdownMenuItem>
                      <DropdownMenuItem disabled={index === lines.length - 1} onSelect={() => onChange(move(lines, index, index + 1))}><ArrowDown />Move down</DropdownMenuItem>
                    </>
                  ) : null}
                  {duplicateLine ? (
                    <DropdownMenuItem onSelect={() => onChange([...lines.slice(0, index + 1), duplicateLine(line), ...lines.slice(index + 1)])}>
                      <Copy />Duplicate
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
              {remove}
            </div>
          );
        } : undefined}
      />
      {error ? <p role="alert" className="text-sm text-state-danger">{error}</p> : null}
      {createLine || footer ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          {createLine ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={() => addLine()}>
                <Plus />{addLabel}
              </Button>
              {extraAddActions}
            </div>
          ) : <span />}
          {footer}
        </div>
      ) : null}
    </div>
  );
}

/** A number cell: decimal keyboard, never negative, the grid's Enter walk. */
export function LineNumberInput({
  value,
  onChange,
  ariaLabel,
  step = "0.01",
  min = "0",
  cellProps,
  disabled,
  describedBy,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  step?: string;
  /** `undefined` allows a negative number (an adjustment's change). */
  min?: string;
  cellProps: ReturnType<LineCellContext["cellProps"]>;
  disabled?: boolean;
  /** The id of a hint under the cell. */
  describedBy?: string;
}) {
  return (
    <Input
      {...cellProps}
      type="number"
      inputMode="decimal"
      min={min}
      step={step}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** A text cell with the grid's Enter walk. */
export function LineTextInput({
  value,
  onChange,
  ariaLabel,
  placeholder,
  cellProps,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  cellProps: ReturnType<LineCellContext["cellProps"]>;
}) {
  return (
    <Input
      {...cellProps}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function move<Line>(lines: Line[], from: number, to: number): Line[] {
  if (to < 0 || to >= lines.length) return lines;
  const next = [...lines];
  const [line] = next.splice(from, 1);
  next.splice(to, 0, line);
  return next;
}
