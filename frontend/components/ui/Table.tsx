"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ArrowUpDown, ArrowDownAZ, ArrowDownZA } from "lucide-react";
import { useTableDensity } from "@/hooks/useTableDensity";

const TableDensityContext = React.createContext<"comfortable" | "compact">("comfortable");

/* ============================================================================
   Root
   ========================================================================== */

const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => {
  const density = useTableDensity();
  return <TableDensityContext.Provider value={density}><div className="w-full" data-table-density={density}>
    <table
      ref={ref}
      className={cn("w-full text-sm border-collapse table-auto", className)}
      {...props}
    />
  </div></TableDensityContext.Provider>;
});
Table.displayName = "Table";


/* ============================================================================
   Sections
   ========================================================================== */

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn(
      "sticky top-0 z-20 bg-surface-raised/95 backdrop-blur-sm",
      "border-b border-line-default",
      "text-copy-muted text-xs select-none",
      className
    )}
    {...props}
  />
));
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("bg-surface", className)} {...props} />
));
TableBody.displayName = "TableBody";

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-2 text-left text-xs text-copy-muted", className)}
    {...props}
  />
));
TableCaption.displayName = "TableCaption";


/* ============================================================================
   Rows
   ========================================================================== */

const TableHeaderRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr ref={ref} className={cn("", className)} {...props} />
));
TableHeaderRow.displayName = "TableHeaderRow";

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-t border-line-subtle",
      "odd:bg-surface even:bg-surface-muted/30",
      "transition-colors duration-100 hover:bg-surface-raised/60",
      className
    )}
    {...props}
  />
));
TableRow.displayName = "TableRow";

const TableGroupRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr ref={ref} className={cn("sticky top-8 z-20 bg-surface-raised", className)} {...props} />
));
TableGroupRow.displayName = "TableGroupRow";


/* ============================================================================
   Cells
   ========================================================================== */

const baseHeadClass =
  "px-4 py-2.5 text-left font-medium text-xs uppercase tracking-wide align-middle " +
  "relative before:content-[''] before:absolute before:top-1/2 before:-translate-y-1/2 " +
  "before:left-0 before:h-3.5 before:w-px before:bg-line-strong/60 first:before:hidden";

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th ref={ref} className={cn(baseHeadClass, className)} {...props} />
));
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => {
  const density = React.useContext(TableDensityContext);
  return <td ref={ref} className={cn("px-4 align-middle", density === "compact" ? "py-2.5" : "py-3.5", className)} {...props} />;
});
TableCell.displayName = "TableCell";

const TableGroupCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "bg-surface-raised px-4 py-2 text-xs font-semibold uppercase tracking-widest text-copy-muted",
      "border-t border-line-default",
      className
    )}
    {...props}
  />
));
TableGroupCell.displayName = "TableGroupCell";


/* ============================================================================
   Sortable header cell
   ========================================================================== */

type SortDirection = "asc" | "desc";

interface SortableHeadProps extends Omit<React.ThHTMLAttributes<HTMLTableCellElement>, "onClick"> {
  sorted?: boolean;
  direction?: SortDirection;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
}

const SortableHead = React.forwardRef<HTMLTableCellElement, SortableHeadProps>(
  ({ sorted, direction = "asc", children, className, onClick, ...props }, ref) => (
    <th
      ref={ref}
      aria-sort={sorted ? (direction === "asc" ? "ascending" : "descending") : "none"}
      className={cn(
        "relative p-0 text-left text-xs font-medium uppercase tracking-wide align-middle",
        "before:absolute before:left-0 before:top-1/2 before:h-3.5 before:w-px before:-translate-y-1/2 before:bg-line-strong/60 first:before:hidden",
        className
      )}
      {...props}
    >
      <button type="button" onClick={onClick} className={cn("flex w-full items-center gap-1.5 px-4 py-2.5 text-left transition-colors duration-100 hover:text-copy-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary", sorted ? "text-copy-primary" : "text-copy-muted")}>
        {children}
        {!sorted && <ArrowUpDown aria-hidden="true" size={11} className="text-copy-disabled" />}
        {sorted && direction === "asc" && <ArrowDownAZ aria-hidden="true" size={11} className="text-copy-secondary" />}
        {sorted && direction === "desc" && <ArrowDownZA aria-hidden="true" size={11} className="text-copy-secondary" />}
      </button>
    </th>
  )
);
SortableHead.displayName = "SortableHead";


export {
  Table,
  TableHeader,
  TableBody,
  TableCaption,
  TableHeaderRow,
  TableRow,
  TableGroupRow,
  TableHead,
  TableCell,
  TableGroupCell,
  SortableHead,
};
