"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ArrowUpDown, ArrowDownAZ, ArrowDownZA } from "lucide-react";




/* ============================================================================
   Root
   Table wrapper gives horizontal scroll while allowing sticky to use the parent
   vertical scroller
   ========================================================================== */

const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <div className="w-full">
    <table
      ref={ref}
      className={cn("w-full text-sm border-collapse table-auto", className)}
      {...props}
    />
  </div>
));
Table.displayName = "Table";




/* ============================================================================
   Sections
   Table semantic sections
   ========================================================================== */

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn("sticky top-0 z-20 bg-neutral-900 border-b border-neutral-800 text-neutral-300 text-xs select-none", className)}
    {...props}
  />
));
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("bg-neutral-950", className)} {...props} />
));
TableBody.displayName = "TableBody";

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-2 text-xs text-neutral-500 text-left", className)}
    {...props}
  />
));
TableCaption.displayName = "TableCaption";




/* ============================================================================
   Rows
   Separate header row so we never reuse body styling inside thead
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
      "border-t border-neutral-800 odd:bg-neutral-900/30 even:bg-neutral-900/60",
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
  <tr ref={ref} className={cn("sticky top-8 z-20 bg-[oklch(22.9%_0_0)]", className)} {...props} />
));
TableGroupRow.displayName = "TableGroupRow";




/* ============================================================================
   Cells
   Sticky is applied to cells only (browser reliable)
   ========================================================================== */

const baseHeadClass =
  "px-4 py-2 text-left font-medium align-middle " +
  "relative before:content-[''] before:absolute before:top-1/2 before:-translate-y-1/2 " +
  "before:left-0 before:h-4 before:w-px before:bg-neutral-700 first:before:hidden";

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
>(({ className, ...props }, ref) => (
  <td ref={ref} className={cn("px-4 py-1.5 align-middle", className)} {...props} />
));
TableCell.displayName = "TableCell";

const TableGroupCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "px-4 py-2 text-xs font-semibold tracking-wide uppercase text-neutral-200 bg-[oklch(22.9%_0_0)]",
      className
    )}
    {...props}
  />
));
TableGroupCell.displayName = "TableGroupCell";




/* ============================================================================
   Sortable header cell
   Visual sort indicator with consistent sticky header behavior
   ========================================================================== */

type SortDirection = "asc" | "desc";

interface SortableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  sorted?: boolean;
  direction?: SortDirection;
}

const SortableHead = React.forwardRef<HTMLTableCellElement, SortableHeadProps>(
  ({ sorted, direction = "asc", children, className, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(baseHeadClass, "cursor-pointer select-none", className)}
      {...props}
    >
      <div className="flex items-center gap-1">
        {children}
        {!sorted && <ArrowUpDown size={12} className="text-neutral-500/80" />}
        {sorted && direction === "asc" && <ArrowDownAZ size={12} className="text-neutral-300" />}
        {sorted && direction === "desc" && <ArrowDownZA size={12} className="text-neutral-300" />}
      </div>
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
