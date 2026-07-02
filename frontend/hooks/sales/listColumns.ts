"use client";

export function getSalesApiColumns(visibleColumns: string[]) {
  return visibleColumns.filter((column) => !column.startsWith("custom:"));
}
