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
