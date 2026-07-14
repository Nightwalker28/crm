"use client";

export function getSalesApiColumns(visibleColumns: string[]) {
  const columns = visibleColumns.filter((column) => !column.startsWith("custom:"));
  if (columns.includes("next_follow_up_at")) columns.push("next_follow_up_is_overdue");
  return columns;
}
