"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/Table";

type Props = {
  columnCount: number;
  rows?: number;
  withCheckbox?: boolean;
};

const WIDTH_CLASSES = [
  "w-28",
  "w-40",
  "w-24",
  "w-32",
  "w-20",
  "w-36",
];

export function ModuleTableLoading({ columnCount, rows = 8, withCheckbox = true }: Props) {
  return (
    <>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <TableRow key={`table-loading-${rowIndex}`} className="hover:bg-transparent">
          {Array.from({ length: columnCount }).map((__, cellIndex) => {
            if (withCheckbox && cellIndex === 0) {
              return (
                <TableCell key={`table-loading-cell-${rowIndex}-${cellIndex}`} className="w-12 pr-0">
                  <Skeleton className="h-4 w-4 rounded-sm bg-neutral-800" />
                </TableCell>
              );
            }

            const widthClass = WIDTH_CLASSES[(rowIndex + cellIndex) % WIDTH_CLASSES.length];
            return (
              <TableCell key={`table-loading-cell-${rowIndex}-${cellIndex}`}>
                <div className="flex items-center gap-3">
                  {cellIndex === 1 ? <Skeleton className="h-7 w-7 rounded-md bg-neutral-800" /> : null}
                  <Skeleton className={`h-4 ${widthClass} bg-neutral-800`} />
                </div>
              </TableCell>
            );
          })}
        </TableRow>
      ))}
    </>
  );
}
