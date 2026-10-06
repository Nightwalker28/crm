"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import { appendSavedViewFilterParams } from "@/lib/savedViewQuery";
import type { SavedViewFilters } from "@/hooks/useSavedViews";
import { usePagedList, type PagedListSort } from "@/hooks/usePagedList";
import { getSalesApiColumns } from "@/hooks/sales/listColumns";
import { findStage, type OpportunityPipeline, type OpportunityStageRef } from "@/components/opportunities/opportunityStages";
import { OPPORTUNITY_PIPELINE_QUERY_KEY } from "@/hooks/sales/useOpportunityPipeline";

export type Opportunity = {
  opportunity_id: number;
  opportunity_name: string;
  sales_stage?: string | null;
  pipeline_id?: number | null;
  pipeline_stage_id?: number | null;
  /** The deal's stage row: label and outcome for display. Present when Stage is enabled. */
  pipeline_stage?: OpportunityStageRef | null;
  contact_id?: number | null;
  organization_id?: number | null;
  assigned_to?: number | null;
  assigned_to_name?: string | null;
  contact_name?: string | null;
  organization_name?: string | null;
  start_date?: string | null;
  expected_close_date?: string | null;
  probability_percent?: number | string | null;
  /** The deal's value (13a A4); a decimal string from the API. */
  amount?: number | string | null;
  currency_type?: string | null;
  deal_type?: string | null;
  source?: string | null;
  next_step?: string | null;
  lost_reason?: string | null;
  custom_fields?: Record<string, unknown> | null;
  created_time?: string | null;
};

export type OpportunityPayload = Omit<Opportunity, "opportunity_id" | "created_time" | "pipeline_id" | "pipeline_stage">;

type OpportunitiesResponse = {
  results: Opportunity[];
  range_start: number;
  range_end: number;
  total_count: number;
  total_pages: number;
  page: number;
};

export type OpportunitySortState = PagedListSort;

async function fetchOpportunities(
  page: number,
  pageSize: number,
  filters: SavedViewFilters,
  visibleColumns: string[],
  sort: OpportunitySortState,
) {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  appendSavedViewFilterParams(params, filters);
  const baseVisibleColumns = getSalesApiColumns(visibleColumns);
  if (baseVisibleColumns.length) {
    params.set("fields", baseVisibleColumns.join(","));
  }
  if (sort) {
    params.set("sort_by", sort.key);
    params.set("sort_direction", sort.direction);
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

async function updateOpportunityStage(opportunityId: number, salesStage: string, lostReason?: string | null) {
  const res = await apiFetch(`/sales/opportunities/${opportunityId}/stage`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sales_stage: salesStage, lost_reason: lostReason ?? null }),
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

export function useOpportunities(
  visibleColumns: string[],
  viewFilters: SavedViewFilters,
  sort: OpportunitySortState = null,
  initialPage = 1,
  initialPageSize = 10,
) {
  const queryClient = useQueryClient();
  const paged = usePagedList<Opportunity, OpportunitiesResponse>({
    queryKey: ["sales-opportunities"],
    fetcher: fetchOpportunities,
    visibleColumns,
    visibleColumnsAffectQuery: true,
    filters: viewFilters,
    sort,
    initialPage,
    initialPageSize,
  });

  const refreshLists = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sales-opportunities"] }),
      queryClient.invalidateQueries({ queryKey: ["sales-opportunities-pipeline-summary"] }),
    ]);
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
  const stageMutation = useMutation({
    mutationFn: ({ opportunityId, salesStage, lostReason }: { opportunityId: number; salesStage: string; lostReason?: string | null }) =>
      updateOpportunityStage(opportunityId, salesStage, lostReason),
    onMutate: async ({ opportunityId, salesStage }) => {
      await queryClient.cancelQueries({ queryKey: ["sales-opportunities"] });
      const previous = queryClient.getQueriesData<OpportunitiesResponse>({ queryKey: ["sales-opportunities"] });
      queryClient.setQueriesData<OpportunitiesResponse>({ queryKey: ["sales-opportunities"] }, (current) => current ? {
        ...current,
        results: current.results.map((opportunity) => opportunity.opportunity_id === opportunityId ? {
          ...opportunity,
          sales_stage: salesStage,
          pipeline_stage: findStage(queryClient.getQueryData<OpportunityPipeline>(OPPORTUNITY_PIPELINE_QUERY_KEY), salesStage) ?? opportunity.pipeline_stage,
        } : opportunity),
      } : current);
      return { previous };
    },
    onError: (_error, _variables, context) => {
      for (const [queryKey, data] of context?.previous ?? []) queryClient.setQueryData(queryKey, data);
    },
    onSettled: refreshLists,
  });
  const deleteMutation = useMutation({
    mutationFn: deleteOpportunity,
    onSuccess: refreshLists,
  });

  return {
    opportunities: paged.items,
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
    createOpportunity: (payload: OpportunityPayload) => createMutation.mutateAsync(payload),
    updateOpportunity: (opportunityId: number, payload: Partial<OpportunityPayload>) =>
      updateMutation.mutateAsync({ opportunityId, payload }),
    updateOpportunityStage: (opportunityId: number, salesStage: string, lostReason?: string | null) =>
      stageMutation.mutateAsync({ opportunityId, salesStage, lostReason }),
    deleteOpportunity: (opportunityId: number) => deleteMutation.mutateAsync(opportunityId),
    isSaving: createMutation.isPending || updateMutation.isPending || stageMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
