"use client";

import { useDeferredValue, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import { appendSavedViewFilterParams } from "@/lib/savedViewQuery";
import type { SavedViewFilters } from "@/hooks/useSavedViews";

export type Contact = {
  contact_id: number;
  first_name: string | null;
  last_name: string | null;
  primary_email: string | null;
  linkedin_url: string | null;
  current_title: string | null;
  region: string | null;
  country: string | null;
  organization_name: string | null;
  assigned_to: number | null;
  created_time: string;
  custom_fields?: Record<string, unknown> | null;
};

export type ContactsResponse = {
  results: Contact[];
  range_start: number;
  range_end: number;
  total_count: number;
  total_pages: number;
  page: number;
};

async function fetchContacts(
  page: number,
  pageSize: number,
  visibleColumns: string[],
  filters: SavedViewFilters,
): Promise<ContactsResponse> {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  const baseVisibleColumns = visibleColumns.filter((column) => !column.startsWith("custom:"));
  if (baseVisibleColumns.length) {
    params.append("fields", baseVisibleColumns.join(","));
  }
  appendSavedViewFilterParams(params, filters);
  const searchTerm = typeof filters.search === "string" ? filters.search.trim() : "";
  const path = searchTerm ? `/sales/contacts/search?${params.toString()}` : `/sales/contacts?${params.toString()}`;
  const res = await apiFetch(path);
  if (!res.ok) throw new Error(`Failed with ${res.status}`);
  return res.json();
}

export function useContacts(
  visibleColumns: string[],
  viewFilters: SavedViewFilters,
  initialPage = 1,
  initialPageSize = 10,
) {
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const deferredFilters = useDeferredValue(viewFilters);

  const query = useQuery({
    queryKey: ["sales-contacts", page, pageSize, visibleColumns, deferredFilters],
    queryFn: () => fetchContacts(page, pageSize, visibleColumns, deferredFilters),
    placeholderData: keepPreviousData,
  });

  const data = query.data;
  const rangeStart = data?.range_start ?? 0;
  const rangeEnd = data?.range_end ?? 0;

  return {
    contacts: data?.results ?? [],
    page: data?.page ?? page,
    totalPages: data?.total_pages ?? 1,
    totalCount: data?.total_count ?? 0,
    rangeStart,
    rangeEnd,
    pageSize,
    isLoading: query.isLoading || query.isFetching,
    error: query.error instanceof Error ? "Failed to load contacts" : null,
    goToPage: setPage,
    onPageSizeChange: (nextPageSize: number) => {
      setPage(1);
      setPageSize(nextPageSize);
    },
    refresh: () => query.refetch(),
  };
}
