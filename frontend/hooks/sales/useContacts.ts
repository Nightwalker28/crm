"use client";

import { apiFetch } from "@/lib/api";
import { appendSavedViewFilterParams } from "@/lib/savedViewQuery";
import type { SavedViewFilters } from "@/hooks/useSavedViews";
import { usePagedList, type PagedListSort } from "@/hooks/usePagedList";
import { getSalesApiColumns } from "@/hooks/sales/listColumns";

export type Contact = {
  contact_id: number;
  first_name: string | null;
  last_name: string | null;
  primary_email: string | null;
  contact_telephone: string | null;
  linkedin_url: string | null;
  current_title: string | null;
  region: string | null;
  country: string | null;
  organization_name: string | null;
  assigned_to: number | null;
  assigned_to_name: string | null;
  created_time: string;
  last_contacted_at: string | null;
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

export type ContactSortState = PagedListSort;

async function fetchContacts(
  page: number,
  pageSize: number,
  filters: SavedViewFilters,
  visibleColumns: string[],
  sort: ContactSortState,
): Promise<ContactsResponse> {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  const baseVisibleColumns = getSalesApiColumns(visibleColumns);
  if (baseVisibleColumns.length) {
    params.append("fields", baseVisibleColumns.join(","));
  }
  if (sort) {
    params.set("sort_by", sort.key);
    params.set("sort_direction", sort.direction);
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
  sort: ContactSortState = null,
  initialPage = 1,
  initialPageSize = 10,
) {
  const paged = usePagedList<Contact, ContactsResponse>({
    queryKey: ["sales-contacts"],
    fetcher: fetchContacts,
    visibleColumns,
    visibleColumnsAffectQuery: true,
    filters: viewFilters,
    sort,
    initialPage,
    initialPageSize,
    errorMessage: () => "Failed to load contacts",
  });

  return {
    contacts: paged.items,
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
