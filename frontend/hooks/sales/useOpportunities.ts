"use client";

import { useDeferredValue, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import { appendSavedViewFilterParams } from "@/lib/savedViewQuery";
import type { SavedViewFilters } from "@/hooks/useSavedViews";

export type Opportunity = {
  opportunity_id: number;
  opportunity_name: string;
  client?: string | null;
  sales_stage?: string | null;
  contact_id?: number | null;
  organization_id?: number | null;
  assigned_to?: number | null;
  start_date?: string | null;
  expected_close_date?: string | null;
  campaign_type?: string | null;
  total_leads?: string | null;
  cpl?: string | null;
  total_cost_of_project?: string | null;
  currency_type?: string | null;
  target_geography?: string | null;
  target_audience?: string | null;
  domain_cap?: string | null;
  tactics?: string | null;
  delivery_format?: string | null;
  attachments?: string[] | null;
  custom_fields?: Record<string, unknown> | null;
  created_time?: string | null;
};

export type OpportunityPayload = Omit<Opportunity, "opportunity_id" | "created_time">;

type OpportunitiesResponse = {
  results: Opportunity[];
  range_start: number;
  range_end: number;
  total_count: number;
  total_pages: number;
  page: number;
};

async function fetchOpportunities(page: number, pageSize: number, filters: SavedViewFilters, visibleColumns: string[]) {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  appendSavedViewFilterParams(params, filters);
  const baseVisibleColumns = visibleColumns.filter((column) => !column.startsWith("custom:"));
  if (baseVisibleColumns.length) {
    params.set("fields", baseVisibleColumns.join(","));
  }
  const search = typeof filters.search === "string" ? filters.search.trim() : "";
  const path = search.trim() ? `/sales/opportunities/search?${params.toString()}` : `/sales/opportunities?${params.toString()}`;
  const res = await apiFetch(path);
  if (!res.ok) throw new Error(`Failed with ${res.status}`);
  return res.json() as Promise<OpportunitiesResponse>;
}

async function createOpportunity(payload: OpportunityPayload) {
  const res = await apiFetch("/sales/opportunities", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Failed with ${res.status}`);
  }
  return res.json();
}

async function updateOpportunity(opportunityId: number, payload: Partial<OpportunityPayload>) {
  const res = await apiFetch(`/sales/opportunities/${opportunityId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Failed with ${res.status}`);
  }
  return res.json();
}

async function deleteOpportunity(opportunityId: number) {
  const res = await apiFetch(`/sales/opportunities/${opportunityId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed with ${res.status}`);
}

async function createFinanceIo(opportunityId: number) {
  const res = await apiFetch(`/sales/opportunities/${opportunityId}/create_finance_io`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed with ${res.status}`);
  return res.json();
}

export function useOpportunities(
  visibleColumns: string[],
  viewFilters: SavedViewFilters,
  initialPage = 1,
  initialPageSize = 10,
) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const deferredFilters = useDeferredValue(viewFilters);

  const query = useQuery({
    queryKey: ["sales-opportunities", page, pageSize, deferredFilters, visibleColumns],
    queryFn: () => fetchOpportunities(page, pageSize, deferredFilters, visibleColumns),
    placeholderData: keepPreviousData,
  });

  const refreshLists = async () => {
    await queryClient.invalidateQueries({ queryKey: ["sales-opportunities"] });
  };

  const createMutation = useMutation({
    mutationFn: createOpportunity,
    onSuccess: refreshLists,
  });
  const updateMutation = useMutation({
    mutationFn: ({ opportunityId, payload }: { opportunityId: number; payload: Partial<OpportunityPayload> }) =>
      updateOpportunity(opportunityId, payload),
    onSuccess: refreshLists,
  });
  const deleteMutation = useMutation({
    mutationFn: deleteOpportunity,
    onSuccess: refreshLists,
  });
  const financeMutation = useMutation({
    mutationFn: createFinanceIo,
  });

  const data = query.data;

  return {
    opportunities: data?.results ?? [],
    page: data?.page ?? page,
    totalPages: data?.total_pages ?? 1,
    totalCount: data?.total_count ?? 0,
    rangeStart: data?.range_start ?? 0,
    rangeEnd: data?.range_end ?? 0,
    pageSize,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error instanceof Error ? query.error.message : null,
    goToPage: setPage,
    onPageSizeChange: (nextPageSize: number) => {
      setPage(1);
      setPageSize(nextPageSize);
    },
    refresh: () => query.refetch(),
    createOpportunity: (payload: OpportunityPayload) => createMutation.mutateAsync(payload),
    updateOpportunity: (opportunityId: number, payload: Partial<OpportunityPayload>) =>
      updateMutation.mutateAsync({ opportunityId, payload }),
    deleteOpportunity: (opportunityId: number) => deleteMutation.mutateAsync(opportunityId),
    createFinanceIo: (opportunityId: number) => financeMutation.mutateAsync(opportunityId),
    isSaving: createMutation.isPending || updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isCreatingFinanceIo: financeMutation.isPending,
  };
}
