"use client";

import { apiFetch } from "@/lib/api";
import { appendSavedViewFilterParams } from "@/lib/savedViewQuery";
import type { SavedViewFilters } from "@/hooks/useSavedViews";
import { usePagedList } from "@/hooks/usePagedList";

export type Lead = {
  lead_id: number;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  primary_email: string | null;
  phone: string | null;
  title: string | null;
  source: string | null;
  status: string | null;
  assigned_to: number | null;
  created_time: string;
  last_contacted_at?: string | null;
  last_contacted_channel?: string | null;
  score?: number | null;
  score_grade?: string | null;
  score_factors?: LeadScoreFactor[] | null;
  score_calculated_at?: string | null;
  custom_fields?: Record<string, unknown> | null;
};

export type LeadScoreFactor = {
  key: string;
  label: string;
  points: number;
  reason: string;
};

export type LeadsResponse = {
  results: Lead[];
  range_start: number;
  range_end: number;
  total_count: number;
  total_pages: number;
  page: number;
};

async function fetchLeads(
  page: number,
  pageSize: number,
  visibleColumns: string[],
  filters: SavedViewFilters,
): Promise<LeadsResponse> {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  const baseVisibleColumns = visibleColumns.filter((column) => !column.startsWith("custom:"));
  if (baseVisibleColumns.length) {
    params.append("fields", baseVisibleColumns.join(","));
  }
  appendSavedViewFilterParams(params, filters);
  const searchTerm = typeof filters.search === "string" ? filters.search.trim() : "";
  const path = searchTerm ? `/sales/leads/search?${params.toString()}` : `/sales/leads?${params.toString()}`;
  const res = await apiFetch(path);
  if (!res.ok) throw new Error(`Failed with ${res.status}`);
  return res.json();
}

export function useLeads(
  visibleColumns: string[],
  viewFilters: SavedViewFilters,
  initialPage = 1,
  initialPageSize = 10,
) {
  const paged = usePagedList<Lead, LeadsResponse>({
    queryKey: ["sales-leads"],
    fetcher: (page, pageSize, filters, columns) => fetchLeads(page, pageSize, columns, filters),
    visibleColumns,
    filters: viewFilters,
    initialPage,
    initialPageSize,
    errorMessage: () => "Failed to load leads",
  });

  return {
    leads: paged.items,
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
