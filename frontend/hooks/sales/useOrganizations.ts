"use client";

import { apiFetch } from "@/lib/api";
import { appendSavedViewFilterParams } from "@/lib/savedViewQuery";
import type { SavedViewFilters } from "@/hooks/useSavedViews";
import { usePagedList, type PagedListSort } from "@/hooks/usePagedList";
import { getSalesApiColumns } from "@/hooks/sales/listColumns";

export type Organization = {
  org_id?: number;
  org_name: string;
  primary_email: string;
  secondary_email?: string;
  website?: string;
  primary_phone?: string;
  secondary_phone?: string;
  industry?: string;
  annual_revenue?: string;
  billing_country?: string;
  assigned_to?: number | null;
  assigned_to_name?: string | null;
  customer_group_id?: number | null;
  created_time?: string | null;
  updated_at?: string | null;
  custom_fields?: Record<string, unknown> | null;
};

export type OrganizationsResponse = {
  results: Organization[];
  range_start: number;
  range_end: number;
  total_count: number;
  total_pages: number;
  page: number;
};

export type OrganizationSortState = PagedListSort;

async function fetchOrganizations(
  page: number,
  pageSize: number,
  filters: SavedViewFilters,
  visibleColumns: string[],
  sort: OrganizationSortState,
): Promise<OrganizationsResponse> {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });

  appendSavedViewFilterParams(params, filters);
  if (sort) {
    params.set("sort_by", sort.key);
    params.set("sort_direction", sort.direction);
  }
  const baseVisibleColumns = getSalesApiColumns(visibleColumns);
  if (baseVisibleColumns.length) {
    params.append("fields", baseVisibleColumns.join(","));
  }

  const res = await apiFetch(`/sales/organizations?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed with ${res.status}`);
  return res.json();
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Failed to load organizations";
}

export function useOrganizations(
  visibleColumns: string[],
  viewFilters: SavedViewFilters,
  sort: OrganizationSortState = null,
  initialPage = 1,
  initialPageSize = 10,
) {
  const paged = usePagedList<Organization, OrganizationsResponse>({
    queryKey: ["sales-organizations"],
    fetcher: fetchOrganizations,
    visibleColumns,
    visibleColumnsAffectQuery: true,
    filters: viewFilters,
    sort,
    initialPage,
    initialPageSize,
    errorMessage: getErrorMessage,
  });

  return {
    organizations: paged.items,
    page: paged.page,
    pageSize: paged.pageSize,
    totalPages: paged.totalPages,
    totalCount: paged.totalCount,
    rangeStart: paged.rangeStart,
    rangeEnd: paged.rangeEnd,
    isLoading: paged.isLoading,
    isFetching: paged.isFetching,
    error: paged.error,
    goToPage: paged.goToPage,
    setPageSize: paged.onPageSizeChange,
    refresh: paged.refresh,
  };
}
