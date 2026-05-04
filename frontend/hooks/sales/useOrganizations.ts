"use client";

import { useState } from "react";
import { toast } from "sonner";

import { apiFetch } from "@/lib/api";
import { appendSavedViewFilterParams } from "@/lib/savedViewQuery";
import type { SavedViewFilters } from "@/hooks/useSavedViews";
import { usePagedList } from "@/hooks/usePagedList";

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

async function fetchOrganizations(
  page: number,
  pageSize: number,
  filters: SavedViewFilters,
  visibleColumns: string[],
): Promise<OrganizationsResponse> {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });

  appendSavedViewFilterParams(params, filters);
  const baseVisibleColumns = visibleColumns.filter((column) => !column.startsWith("custom:"));
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
  initialPage = 1,
  initialPageSize = 10,
) {
  const [createOpen, setCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const paged = usePagedList<Organization, OrganizationsResponse>({
    queryKey: ["sales-organizations"],
    fetcher: fetchOrganizations,
    visibleColumns,
    filters: viewFilters,
    initialPage,
    initialPageSize,
    errorMessage: getErrorMessage,
  });

  async function createOrganization(payload: Record<string, unknown>) {
    try {
      setIsCreating(true);
      const res = await apiFetch("/sales/organizations/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? `Failed with ${res.status}`);
      }

      await paged.refresh();
      setCreateOpen(false);
      toast.success("Organization created.");
    } catch (error) {
      console.error(error);
      toast.error("Failed to create organization.");
    } finally {
      setIsCreating(false);
    }
  }

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
    createOpen,
    isCreating,

    goToPage: paged.goToPage,
    setPageSize: paged.onPageSizeChange,
    refresh: paged.refresh,
    setCreateOpen,
    createOrganization,
  };
}
