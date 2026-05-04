// Pagination.tsx

"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";

type PaginationProps = {
  page: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  rangeStart: number;
  rangeEnd: number;
  isRefreshing?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
};

const FALLBACK_PAGE_SIZE_OPTIONS = [10, 25, 50];

type PaginationConfig = {
  page_size_options: number[];
};

async function fetchPaginationConfig() {
  try {
    const res = await apiFetch("/config/pagination");
    if (!res.ok) {
      return { page_size_options: FALLBACK_PAGE_SIZE_OPTIONS };
    }
    return res.json() as Promise<PaginationConfig>;
  } catch {
    return { page_size_options: FALLBACK_PAGE_SIZE_OPTIONS };
  }
}

function getPageNumbers(current: number, total: number): (number | "...")[] {
  if (total <= 4) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | "...")[] = [];
  const add = (n: number | "...") => pages.push(n);

  add(1);

  if (current > 3) add("...");

  for (let p = current - 1; p <= current + 1; p++) {
    if (p > 1 && p < total) add(p);
  }

  if (current < total - 2) add("...");

  add(total);

  return pages;
}

export default function Pagination({
  page,
  totalPages,
  totalCount,
  pageSize,
  rangeStart,
  rangeEnd,
  isRefreshing = false,
  onPageChange,
  onPageSizeChange,
}: PaginationProps) {
  const pages = getPageNumbers(page, totalPages);
  const { data: paginationConfig } = useQuery({
    queryKey: ["pagination-config"],
    queryFn: fetchPaginationConfig,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const pageSizeOptions =
    Array.isArray(paginationConfig?.page_size_options) && paginationConfig.page_size_options.length > 0
      ? paginationConfig.page_size_options
      : FALLBACK_PAGE_SIZE_OPTIONS;

  return (
    <div className="flex flex-col md:flex-row items-center justify-between gap-4 w-full text-xs md:text-sm text-neutral-400">
      
      {/* Left: Rows per page Dropdown */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Label className="font-normal">Items per page</Label>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => onPageSizeChange(Number(value))}
          >
            <SelectTrigger className="h-7! w-[65px] text-xs">
              <SelectValue placeholder={pageSize} />
            </SelectTrigger>
            <SelectContent className="">
              {pageSizeOptions.map((size) => (
                <SelectItem key={size} value={String(size)} className="text-xs">
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="whitespace-nowrap">
          Showing{" "}
          <span className="text-neutral-200 font-medium">{rangeStart}</span>
          {" – "}
          <span className="text-neutral-200 font-medium">{rangeEnd}</span>
          {" of "}
          <span className="text-neutral-200 font-medium">{totalCount}</span>{" "}
          entries
        </div>
        {isRefreshing ? (
          <div className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-neutral-900/80 px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-neutral-400">
            <span className="h-2 w-2 rounded-full bg-neutral-400 animate-pulse" />
            Refreshing
          </div>
        ) : null}
      </div>


      {/* Right: Page Navigation */}
      <div className="flex items-center gap-3">
        
        {/* Previous Button */}
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="flex p-2 items-center justify-center rounded-md bg-neutral-800/90 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-30 disabled:hover:bg-neutral-900 disabled:cursor-not-allowed transition-all"
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        {/* Page Numbers Container */}
        <div className="flex items-center bg-neutral-800/90 rounded-md px-1.5">
          {pages.map((p, i) =>
            p === "..." ? (
              <div
                key={`ellipsis-${i}`}
                className="h-8 w-8 flex items-center justify-center text-neutral-600 text-xs"
              >
                <MoreHorizontal className="h-4 w-4" />
              </div>
            ) : (
              <button
                key={p}
                onClick={() => onPageChange(p)}
                className={`
                  relative isolate min-w-8 p-2 rounded-md text-xs font-medium overflow-hidden transition-colors
                  ${p === page ? "text-neutral-950" : "text-neutral-400 hover:text-neutral-200"}
                `}
              >
                {/* Expanding White Background Animation */}
                <span
                  className={`
                    absolute inset-0 -z-10 bg-neutral-200 origin-center rounded-md 
                    ${p === page 
                      ? "scale-100 transition-transform duration-300 ease-out" // Animate IN
                      : "scale-0 transition-none" // Instant OUT (No contract animation)
                    }
                  `}
                />
                
                {/* Text (z-10 ensures it stays on top of the background) */}
                <span className="relative z-10">{p}</span>
              </button>
            )
          )}
        </div>

        {/* Next Button */}
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="flex p-2 items-center justify-center rounded-md bg-neutral-800/90 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-30 disabled:hover:bg-neutral-900 disabled:cursor-not-allowed transition-all"
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
