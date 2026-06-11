"use client";

import { apiFetch } from "@/lib/api";
import { appendSavedViewFilterParams } from "@/lib/savedViewQuery";
import type { SavedViewFilters } from "@/hooks/useSavedViews";
import { usePagedList, type PagedListSort } from "@/hooks/usePagedList";

export type SupportCaseSortState = PagedListSort;

export type SupportCaseComment = {
  id: number;
  case_id: number;
  author_id: number | null;
  body: string;
  is_internal: boolean;
  created_at: string;
};

export type SupportCaseEvent = {
  id: number;
  case_id: number;
  event_type: string;
  payload_json: Record<string, unknown>;
  created_by_id: number | null;
  created_at: string;
};

export type SupportCase = {
  id: number;
  tenant_id?: number;
  case_number: string;
  subject: string;
  description: string | null;
  category: string | null;
  status: string;
  priority: string;
  source: string | null;
  contact_id: number | null;
  organization_id: number | null;
  opportunity_id: number | null;
  quote_id: number | null;
  order_id: number | null;
  assigned_to_id: number | null;
  created_by_id?: number | null;
  sla_due_at: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  comments?: SupportCaseComment[];
  events?: SupportCaseEvent[];
};

export type SupportCasesResponse = {
  results: SupportCase[];
  range_start: number;
  range_end: number;
  total_count: number;
  total_pages: number;
  page: number;
};

async function fetchCases(page: number, pageSize: number, _visibleColumns: string[], filters: SavedViewFilters, sort: SupportCaseSortState): Promise<SupportCasesResponse> {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (sort) {
    params.set("sort_by", sort.key);
    params.set("sort_direction", sort.direction);
  }
  appendSavedViewFilterParams(params, filters);
  const searchTerm = typeof filters.search === "string" ? filters.search.trim() : "";
  const path = searchTerm ? `/support/cases/search?${params.toString()}` : `/support/cases?${params.toString()}`;
  const res = await apiFetch(path);
  if (!res.ok) throw new Error(`Failed with ${res.status}`);
  return res.json();
}

export function useSupportCases(visibleColumns: string[], viewFilters: SavedViewFilters, sort: SupportCaseSortState = null, initialPage = 1, initialPageSize = 10) {
  const paged = usePagedList<SupportCase, SupportCasesResponse>({
    queryKey: ["support-cases"],
    fetcher: (page, pageSize, filters, columns, sortState) => fetchCases(page, pageSize, columns, filters, sortState),
    visibleColumns,
    filters: viewFilters,
    sort,
    initialPage,
    initialPageSize,
    errorMessage: () => "Failed to load support cases",
  });

  return {
    cases: paged.items,
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
