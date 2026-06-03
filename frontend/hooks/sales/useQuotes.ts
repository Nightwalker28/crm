"use client";

import { apiFetch } from "@/lib/api";
import { appendSavedViewFilterParams } from "@/lib/savedViewQuery";
import type { SavedViewFilters } from "@/hooks/useSavedViews";
import { usePagedList, type PagedListSort } from "@/hooks/usePagedList";

export type Quote = {
  quote_id: number;
  quote_number: string;
  title: string | null;
  customer_name: string | null;
  contact_id: number | null;
  organization_id: number | null;
  opportunity_id: number | null;
  status: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  currency: string | null;
  subtotal_amount: string | number | null;
  discount_amount: string | number | null;
  tax_amount: string | number | null;
  total_amount: string | number | null;
  assigned_to: number | null;
  created_time: string;
  updated_at?: string | null;
  custom_fields?: Record<string, unknown> | null;
};

export type QuotesResponse = {
  results: Quote[];
  range_start: number;
  range_end: number;
  total_count: number;
  total_pages: number;
  page: number;
};

export type QuoteSortState = PagedListSort;

async function fetchQuotes(
  page: number,
  pageSize: number,
  visibleColumns: string[],
  filters: SavedViewFilters,
  sort: QuoteSortState,
): Promise<QuotesResponse> {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  const baseVisibleColumns = visibleColumns.filter((column) => !column.startsWith("custom:"));
  if (baseVisibleColumns.length) params.append("fields", baseVisibleColumns.join(","));
  if (sort) {
    params.set("sort_by", sort.key);
    params.set("sort_direction", sort.direction);
  }
  appendSavedViewFilterParams(params, filters);
  const searchTerm = typeof filters.search === "string" ? filters.search.trim() : "";
  const path = searchTerm ? `/sales/quotes/search?${params.toString()}` : `/sales/quotes?${params.toString()}`;
  const res = await apiFetch(path);
  if (!res.ok) throw new Error(`Failed with ${res.status}`);
  return res.json();
}

export function useQuotes(
  visibleColumns: string[],
  viewFilters: SavedViewFilters,
  sort: QuoteSortState = null,
  initialPage = 1,
  initialPageSize = 10,
) {
  const paged = usePagedList<Quote, QuotesResponse>({
    queryKey: ["sales-quotes"],
    fetcher: (page, pageSize, filters, columns, sortState) => fetchQuotes(page, pageSize, columns, filters, sortState),
    visibleColumns,
    filters: viewFilters,
    sort,
    initialPage,
    initialPageSize,
    errorMessage: () => "Failed to load quotes",
  });

  return {
    quotes: paged.items,
    page: paged.page,
    totalPages: paged.totalPages,
    totalCount: paged.totalCount,
    rangeStart: paged.rangeStart,
    rangeEnd: paged.rangeEnd,
    pageSize: paged.pageSize,
    isLoading: paged.isLoading,
    isFetching: paged.isFetching,
    error: paged.error,
    goToPage: paged.goToPage,
    onPageSizeChange: paged.onPageSizeChange,
    refresh: paged.refresh,
  };
}
