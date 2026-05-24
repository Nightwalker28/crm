"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Rows3 } from "lucide-react";

import { SortableHead, Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { CustomFieldCell } from "@/components/ui/CustomFieldCell";
import { EmptyState } from "@/components/ui/EmptyState";
import { ModuleTableLoading } from "@/components/ui/ModuleTableLoading";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import type { TableColumnOption } from "@/hooks/useTablePreferences";
import { formatDateTime } from "@/lib/datetime";
import { getReadableColumnLabel, isCustomFieldColumnKey } from "@/lib/moduleViewConfigs";
import type { __Module__ } from "@/types/__modules__";

type SortState = { column: string; direction: "asc" | "desc" } | null;

type Props = {
  records: __Module__[];
  isLoading: boolean;
  isRefreshing?: boolean;
  visibleColumns: string[];
  columnOptions?: TableColumnOption[];
};

export default function __Modules__Table({ records, isLoading, isRefreshing = false, visibleColumns, columnOptions = [] }: Props) {
  const router = useRouter();
  const [sort, setSort] = useState<SortState>(null);
  const sortedRecords = useMemo(() => {
    if (!sort) return records;
    return [...records].sort((left, right) => {
      const leftValue = String(left[sort.column as keyof __Module__] ?? "").toLowerCase();
      const rightValue = String(right[sort.column as keyof __Module__] ?? "").toLowerCase();
      const result = leftValue.localeCompare(rightValue, undefined, { numeric: true });
      return sort.direction === "asc" ? result : -result;
    });
  }, [records, sort]);

  function toggleSort(column: string) {
    setSort((current) => current?.column === column ? { column, direction: current.direction === "asc" ? "desc" : "asc" } : { column, direction: "asc" });
  }

  function renderCell(record: __Module__, column: string) {
    if (isCustomFieldColumnKey(column)) return <CustomFieldCell column={column} values={record.custom_fields} />;
    if (column === "created_time") return <TableCell><span className="text-sm text-neutral-400">{record.created_time ? formatDateTime(record.created_time) : "-"}</span></TableCell>;
    return <TableCell><span className="text-sm text-neutral-300">{String(record[column as keyof __Module__] ?? "") || <span className="text-neutral-600">-</span>}</span></TableCell>;
  }

  return (
    <ModuleTableShell isRefreshing={isRefreshing}>
      <Table className="min-w-[760px]">
        <TableHeader>
          <TableHeaderRow>
            {visibleColumns.map((column) => {
              const label = getReadableColumnLabel(column, columnOptions);
              return !isCustomFieldColumnKey(column) ? (
                <SortableHead key={column} sorted={sort?.column === column} direction={sort?.column === column ? sort.direction : "asc"} onClick={() => toggleSort(column)}>
                  {label}
                </SortableHead>
              ) : (
                <TableHead key={column}>{label}</TableHead>
              );
            })}
          </TableHeaderRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <ModuleTableLoading columnCount={visibleColumns.length} />
          ) : records.length === 0 ? (
            <TableRow>
              <TableCell colSpan={visibleColumns.length} className="py-16 text-center">
                <EmptyState icon={Rows3} title="No __display_name__ found" description="Records matching the current view will appear here." />
              </TableCell>
            </TableRow>
          ) : (
            sortedRecords.map((record) => (
              <TableRow key={record.__id_field__} className="group cursor-pointer" onClick={() => router.push(`__route_prefix__/${record.__id_field__}`)}>
                {visibleColumns.map((column) => <Fragment key={column}>{renderCell(record, column)}</Fragment>)}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </ModuleTableShell>
  );
}
