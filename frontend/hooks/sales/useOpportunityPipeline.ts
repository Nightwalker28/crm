"use client";

import { useQuery } from "@tanstack/react-query";

import { resolveStage, UNSTAGED_LABEL, type OpportunityPipeline } from "@/components/opportunities/opportunityStages";
import { apiFetch } from "@/lib/api";

export const OPPORTUNITY_PIPELINE_QUERY_KEY = ["sales-opportunity-pipeline"] as const;

async function fetchOpportunityPipeline(): Promise<OpportunityPipeline> {
  const res = await apiFetch("/sales/opportunities/pipeline");
  if (!res.ok) throw new Error("deal-pipeline-unavailable");
  return res.json() as Promise<OpportunityPipeline>;
}

/**
 * The tenant's deal pipeline: every stage in board order, inactive ones flagged.
 *
 * The one source of stage options, labels, order and outcome on the client (04 frontend
 * Phase 1). Stages change only through pipeline settings, so a long stale time is safe;
 * the settings screen invalidates this key when it saves.
 */
export function useOpportunityPipeline(enabled = true) {
  return useQuery({
    queryKey: OPPORTUNITY_PIPELINE_QUERY_KEY,
    queryFn: fetchOpportunityPipeline,
    staleTime: 5 * 60_000,
    enabled,
  });
}

/**
 * A stage key → display label function, for places that only hold a deal's key (related-deal
 * lists). Falls back to the key in sentence case while the pipeline loads or is unavailable.
 */
export function useOpportunityStageLabel(enabled = true) {
  const { data: pipeline } = useOpportunityPipeline(enabled);
  return (key?: string | null) => resolveStage(pipeline, key)?.label ?? UNSTAGED_LABEL;
}

export type PipelineStageChange = Partial<{
  label: string;
  semantic_type: string;
  probability: number;
  is_active: boolean;
}>;

export type PipelineStageUsage = { pipeline_id: number; stages: Array<{ stage_id: number; live_deal_count: number }> };

export const PIPELINE_STAGE_USAGE_QUERY_KEY = ["sales-opportunity-pipeline-usage"] as const;

/** A write the server refused, carrying its own explanation for the row that sent it. */
export class PipelineSettingsError extends Error {}

async function readPipelineResponse(res: Response): Promise<OpportunityPipeline> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = typeof body?.detail === "string" ? body.detail : "The change could not be saved. Try again.";
    throw new PipelineSettingsError(detail);
  }
  return res.json() as Promise<OpportunityPipeline>;
}

export async function updatePipelineStage(stageId: number, change: PipelineStageChange) {
  const res = await apiFetch(`/sales/opportunities/pipeline/stages/${stageId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(change),
  });
  return readPipelineResponse(res);
}

export async function reorderPipelineStages(stageIds: number[]) {
  const res = await apiFetch("/sales/opportunities/pipeline/stage-order", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stage_ids: stageIds }),
  });
  return readPipelineResponse(res);
}

/** Live deals per stage, for the warning before a stage is deactivated. Configure-only. */
export function usePipelineStageUsage(enabled: boolean) {
  return useQuery({
    queryKey: PIPELINE_STAGE_USAGE_QUERY_KEY,
    queryFn: async (): Promise<PipelineStageUsage> => {
      const res = await apiFetch("/sales/opportunities/pipeline/stage-usage");
      if (!res.ok) throw new Error("deal-pipeline-usage-unavailable");
      return res.json() as Promise<PipelineStageUsage>;
    },
    enabled,
    staleTime: 30_000,
  });
}
