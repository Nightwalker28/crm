"use client";

import { AlertTriangle, BriefcaseBusiness } from "lucide-react";

import { Board, type BoardColumn } from "@/components/ui/Board";
import { Button } from "@/components/ui/button";
import { EmptyValue } from "@/components/ui/EmptyValue";
import type { Opportunity } from "@/hooks/sales/useOpportunities";
import { formatDateOnly } from "@/lib/datetime";
import {
  isClosedSemantic,
  normalizeStageKey,
  orderedStages,
  stageStatus,
  UNSTAGED_LABEL,
  type OpportunityPipeline,
} from "@/components/opportunities/opportunityStages";
import { useOpportunityPipeline } from "@/hooks/sales/useOpportunityPipeline";

type Props = {
  opportunities: Opportunity[];
  isLoading: boolean;
  isRefreshing?: boolean;
  hasError?: boolean;
  onRetry?: () => void;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
  onCreate?: () => void;
  onStageChange: (opportunity: Opportunity, salesStage: string) => Promise<void> | void;
};

const UNSTAGED = "unstaged";

/**
 * Columns are the tenant's stages in board order, then *Unstaged*, which collects a deal whose
 * stage is empty or unknown and is never a move target. An inactive stage is a column only
 * while a loaded deal still sits in it, and it accepts no new cards.
 */
function buildColumns(pipeline: OpportunityPipeline | undefined, opportunities: Opportunity[]): BoardColumn[] {
  const occupied = new Set(opportunities.map((opportunity) => normalizeStageKey(opportunity.sales_stage)));
  const stageColumns = orderedStages(pipeline)
    .filter((stage) => stage.is_active || occupied.has(stage.key))
    .map((stage) => ({ key: stage.key, label: stage.label, status: stageStatus(stage), acceptsCards: stage.is_active }));
  return [...stageColumns, { key: UNSTAGED, label: UNSTAGED_LABEL, status: stageStatus(null), acceptsCards: false }];
}

function isOverdue(opportunity: Opportunity) {
  if (!opportunity.expected_close_date || isClosedSemantic(opportunity.pipeline_stage?.semantic_type)) return false;
  return new Date(`${opportunity.expected_close_date}T23:59:59`).getTime() < Date.now();
}

export default function OpportunitiesPipelineBoard({
  opportunities,
  isLoading,
  isRefreshing = false,
  hasError = false,
  onRetry,
  hasActiveFilters = false,
  onClearFilters,
  onCreate,
  onStageChange,
}: Props) {
  const pipelineQuery = useOpportunityPipeline();
  const columns = buildColumns(pipelineQuery.data, opportunities);
  const columnKeys = new Set(columns.map((column) => column.key));
  const stageOf = (opportunity: Opportunity) => {
    const stage = normalizeStageKey(opportunity.sales_stage);
    return columnKeys.has(stage) ? stage : UNSTAGED;
  };
  return (
    <Board
      label="Deals"
      moveFieldLabel="stage"
      columns={columns}
      items={opportunities}
      getKey={(opportunity) => opportunity.opportunity_id}
      getColumn={stageOf}
      getItemLabel={(opportunity) => opportunity.opportunity_name}
      getItemHref={(opportunity) => `/dashboard/sales/opportunities/${opportunity.opportunity_id}`}
      onMove={onStageChange}
      renderCardBody={(opportunity) => (
        <>
          <div className="truncate">{opportunity.organization_name || opportunity.client || <EmptyValue />}</div>
          <div className="truncate">{opportunity.assigned_to_name ? `Owner ${opportunity.assigned_to_name}` : "Unassigned"}</div>
          <div>Close {opportunity.expected_close_date ? formatDateOnly(opportunity.expected_close_date) : "not set"}</div>
          {/* Free text in the schema (`Text`, not a number), so it is printed as written, not through `<Money>`. */}
          <div className="tabular-nums text-copy-secondary">
            {opportunity.total_cost_of_project?.trim() ? `${opportunity.total_cost_of_project} ${opportunity.currency_type || ""}`.trim() : "No value"}
          </div>
          {isOverdue(opportunity) ? (
            <div className="inline-flex items-center gap-1 text-state-warning">
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              Overdue
            </div>
          ) : null}
        </>
      )}
      isLoading={isLoading || pipelineQuery.isLoading}
      isRefreshing={isRefreshing}
      hasError={hasError || pipelineQuery.isError}
      onRetry={() => {
        if (pipelineQuery.isError) void pipelineQuery.refetch();
        onRetry?.();
      }}
      hasActiveFilters={hasActiveFilters}
      onClearFilters={onClearFilters}
      // The table's words, so switching display does not change what the empty list says.
      emptyState={{
        icon: BriefcaseBusiness,
        title: "No deals yet",
        description: "Create your first deal to start tracking the pipeline.",
        action: onCreate ? <Button type="button" onClick={onCreate}>Create deal</Button> : undefined,
      }}
      filteredEmptyState={{
        title: "No matching deals",
        description: "Try changing or clearing the current search and filters.",
      }}
    />
  );
}
