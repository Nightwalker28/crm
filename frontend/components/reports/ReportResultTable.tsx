"use client";

import { useState } from "react";
import { BarChart3, ListFilter } from "lucide-react";

import { EmptyValue } from "@/components/ui/EmptyValue";
import { Field, FieldLabel } from "@/components/ui/field";
import Pagination from "@/components/ui/Pagination";
import { RecordTable, type RecordTableColumn } from "@/components/ui/RecordTable";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatMeasureValue, formatRecordValue, type ReportRecord, type ReportRecords, type ReportResult, type ReportRow } from "@/lib/reports";

type DrillHandler = (keys: string[], label: string) => void;

const TOTAL_KEY = "__total__";

/**
 * The table under a report's chart, and the chart's table view (dataviz: a table always
 * exists). Every group, cell and the total opens its records, the way a Dynamics chart
 * segment or an Odoo pivot cell does.
 *
 * All three shapes are `RecordTable` (design.md §7.10): a summary is a list of groups, a
 * second grouping bands it with the subtotal in the band, and a matrix is a list of row
 * groups whose columns are the column grouping's values. None is a third table.
 */
export function ReportResultTable({ result, onDrill, hasFilters, onClearFilters }: {
  result: ReportResult;
  onDrill: DrillHandler;
  hasFilters?: boolean;
  onClearFilters?: () => void;
}) {
  const emptyState = { icon: BarChart3, title: hasFilters ? "No records match this report" : "No records to report on yet", description: hasFilters ? "Widen the date range or remove a filter." : "Records appear here as soon as the module has some." };
  const filteredEmptyState = { icon: ListFilter, title: "No records match this report", description: "Widen the date range or remove a filter." };
  if (result.config.format === "matrix") {
    return <MatrixReportTable result={result} onDrill={onDrill} emptyState={emptyState} hasFilters={hasFilters} onClearFilters={onClearFilters} filteredEmptyState={filteredEmptyState} />;
  }

  const measures = result.measures.filter((measure) => measure.aggregate !== "count");
  const twoLevel = result.groupings.length === 2;
  const subtotalByKey = new Map(result.subtotals.map((row) => [row.keys[0], row]));
  const totalRow: ReportRow = { keys: [], labels: ["Total"], count: result.totals.count, values: result.totals.values };
  const rows = result.rows.length ? [...result.rows, totalRow] : [];
  const measureIndexes = result.measures.map((measure, index) => (measure.aggregate === "count" ? -1 : index)).filter((index) => index >= 0);
  const isTotal = (row: ReportRow) => row.keys.length === 0;

  const columns: RecordTableColumn<ReportRow>[] = [
    {
      key: "group",
      label: twoLevel ? result.groupings[1].label : result.groupings[0]?.label ?? "Group",
      size: "lg",
      render: (row) => <span className={isTotal(row) ? "font-semibold text-copy-primary" : "font-medium text-copy-primary"}>{row.labels[row.labels.length - 1]}</span>,
    },
    { key: "count", label: "Records", align: "right", render: (row) => <span className={isTotal(row) ? "font-semibold tabular-nums" : "tabular-nums"}>{formatMeasureValue(row.count, "number")}</span> },
    ...measures.map((measure, position) => ({
      key: measure.key,
      label: measure.label,
      align: "right" as const,
      render: (row: ReportRow) => <span className={isTotal(row) ? "font-semibold tabular-nums" : "tabular-nums"}>{formatMeasureValue(row.values[measureIndexes[position]], measure.field_type)}</span>,
    })),
  ];

  return (
    <RecordTable
      label={`${result.label} report`}
      shellVariant="nested"
      columns={columns}
      rows={rows}
      rowKey={(row) => (isTotal(row) ? TOTAL_KEY : row.keys.join("\u0000"))}
      onOpenRow={(row) => onDrill(row.keys, isTotal(row) ? "All records" : row.labels.join(" · "))}
      rowLabel={(row) => (isTotal(row) ? "Show all records in this report" : `Show records for ${row.labels.join(", ")}`)}
      groupBy={twoLevel ? (row) => {
        if (isTotal(row)) return "All groups";
        const subtotal = subtotalByKey.get(row.keys[0]);
        const figure = subtotal ? (measures.length ? formatMeasureValue(subtotal.values[measureIndexes[0]], measures[0].field_type) : `${formatMeasureValue(subtotal.count, "number")} records`) : "";
        return figure ? `${row.labels[0]} · ${figure}` : row.labels[0];
      } : undefined}
      emptyState={emptyState}
      hasActiveFilters={hasFilters}
      onClearFilters={onClearFilters}
      filteredEmptyState={filteredEmptyState}
    />
  );
}

type MatrixRow = { key: string; label: string; cells: Map<string, ReportRow>; subtotal: ReportRow | undefined; isTotal?: boolean };

function MatrixReportTable({ result, onDrill, emptyState, hasFilters, onClearFilters, filteredEmptyState }: {
  result: ReportResult;
  onDrill: DrillHandler;
  emptyState: { icon: typeof BarChart3; title: string; description: string };
  filteredEmptyState: { icon: typeof BarChart3; title: string; description: string };
  hasFilters?: boolean;
  onClearFilters?: () => void;
}) {
  // A matrix cell holds one figure, so with several measures the operator picks which.
  const [measureIndex, setMeasureIndex] = useState(0);
  const measure = result.measures[Math.min(measureIndex, result.measures.length - 1)];
  const index = Math.min(measureIndex, result.measures.length - 1);
  const value = (row: ReportRow | undefined) => (row ? (measure.aggregate === "count" ? row.count : row.values[index]) : null);

  const rows: MatrixRow[] = result.row_groups.map((group) => ({
    key: group.key,
    label: group.label,
    cells: new Map(result.rows.filter((row) => row.keys[0] === group.key).map((row) => [row.keys[1], row])),
    subtotal: result.subtotals.find((row) => row.keys[0] === group.key),
  }));
  if (rows.length) {
    rows.push({ key: TOTAL_KEY, label: "Total", cells: new Map(), subtotal: { keys: [], labels: ["Total"], count: result.totals.count, values: result.totals.values }, isTotal: true });
  }

  const columns: RecordTableColumn<MatrixRow>[] = [
    { key: "group", label: result.groupings[0].label, size: "lg", render: (row) => <span className={row.isTotal ? "font-semibold text-copy-primary" : "font-medium text-copy-primary"}>{row.label}</span> },
    ...result.column_groups.map((column) => ({
      key: `column-${column.key}`,
      label: column.label,
      align: "right" as const,
      size: "sm" as const,
      interactive: true,
      render: (row: MatrixRow) => {
        if (row.isTotal) return null;
        const cell = row.cells.get(column.key);
        const figure = value(cell);
        if (!cell || figure === null) return <EmptyValue />;
        return (
          <button
            type="button"
            className="tabular-nums text-copy-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            aria-label={`Show records for ${row.label}, ${column.label}`}
            onClick={() => onDrill([row.key, column.key], `${row.label} · ${column.label}`)}
          >
            {formatMeasureValue(figure, measure.field_type)}
          </button>
        );
      },
    })),
    {
      key: "total",
      label: "Total",
      align: "right",
      render: (row) => <span className="font-semibold tabular-nums">{formatMeasureValue(value(row.subtotal), measure.field_type)}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {result.measures.length > 1 ? (
        <Field className="sm:w-64">
          <FieldLabel htmlFor="matrix-measure">Cells show</FieldLabel>
          <Select value={String(index)} onValueChange={(next) => setMeasureIndex(Number(next))}>
            <SelectTrigger id="matrix-measure" aria-label="Cells show"><SelectValue /></SelectTrigger>
            <SelectContent>
              {result.measures.map((item, position) => <SelectItem key={item.key} value={String(position)}>{item.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      ) : null}
      <RecordTable
        label={`${result.label} matrix`}
        shellVariant="nested"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.key}
        onOpenRow={(row) => onDrill(row.isTotal ? [] : [row.key], row.isTotal ? "All records" : row.label)}
        rowLabel={(row) => (row.isTotal ? "Show all records in this report" : `Show records for ${row.label}`)}
        emptyState={emptyState}
        hasActiveFilters={hasFilters}
        onClearFilters={onClearFilters}
        filteredEmptyState={filteredEmptyState}
      />
    </div>
  );
}

/** Records with the report's columns: a tabular report, and the drill-down panel. */
export function ReportRecordsTable({ records, label, page, pageSize, onPageChange, onPageSizeChange, isLoading, isRefreshing, hasError, onRetry }: {
  records: ReportRecords | undefined;
  label: string;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  isLoading?: boolean;
  isRefreshing?: boolean;
  hasError?: boolean;
  onRetry?: () => void;
}) {
  const columns: RecordTableColumn<ReportRecord>[] = [
    { key: "__label", label: "Name", size: "lg", render: (record) => <span className="font-medium text-copy-primary">{record.label}</span> },
    ...(records?.columns ?? [])
      .map((column) => ({
        key: column.key,
        label: column.label,
        align: column.field_type === "money" || column.field_type === "number" ? ("right" as const) : ("left" as const),
        render: (record: ReportRecord) => {
          const text = formatRecordValue(record.values[column.key], column);
          return text === null ? <EmptyValue /> : <span className={column.field_type === "money" || column.field_type === "number" ? "tabular-nums" : undefined}>{text}</span>;
        },
      })),
  ];
  const total = records?.total ?? 0;
  const rangeStart = total ? (page - 1) * pageSize + 1 : 0;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <RecordTable
        label={label}
        shellVariant="nested"
        columns={columns}
        rows={records?.records ?? []}
        rowKey={(record) => record.id}
        // Tasks have no record page, so their rows do not open.
        rowHref={records?.records.some((record) => record.path) ? (record) => record.path ?? "" : undefined}
        rowLabel={(record) => `Open ${record.label}`}
        isLoading={isLoading}
        isRefreshing={isRefreshing}
        hasError={hasError}
        onRetry={onRetry}
        emptyState={{ icon: ListFilter, title: "No records here", description: "Nothing in this report matches." }}
      />
      {total > pageSize ? (
        <Pagination
          page={page}
          totalPages={Math.max(1, Math.ceil(total / pageSize))}
          totalCount={total}
          pageSize={pageSize}
          rangeStart={rangeStart}
          rangeEnd={Math.min(total, page * pageSize)}
          isRefreshing={isRefreshing}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      ) : null}
    </div>
  );
}
