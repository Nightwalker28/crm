"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
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
        rowActionsLabel="Remove"
        rowActions={createLine ? (line) => {
          const index = lines.indexOf(line);
          return (
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
        } : undefined}
      />
      {error ? <p role="alert" className="text-sm text-state-danger">{error}</p> : null}
      {createLine || footer ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          {createLine ? (
            <Button type="button" variant="outline" onClick={() => addLine()}>
              <Plus />{addLabel}
            </Button>
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
