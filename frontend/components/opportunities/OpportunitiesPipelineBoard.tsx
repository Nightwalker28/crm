"use client";

import { AlertTriangle, BriefcaseBusiness } from "lucide-react";

import { Board, type BoardColumn } from "@/components/ui/Board";
import { Button } from "@/components/ui/button";
import { EmptyValue } from "@/components/ui/EmptyValue";
import type { Opportunity } from "@/hooks/sales/useOpportunities";
import { formatDateOnly } from "@/lib/datetime";
import {
  getOpportunityStage,
  normalizeOpportunityStage,
  OPPORTUNITY_STAGE_ORDER,
} from "@/components/opportunities/opportunityStages";

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

const STAGE_KEYS = new Set<string>(OPPORTUNITY_STAGE_ORDER);

// *Unstaged* collects a deal whose stage is empty or unknown. A deal is never moved into it.
const COLUMNS: BoardColumn[] = [...OPPORTUNITY_STAGE_ORDER, "unstaged"].map((key) => {
  const status = getOpportunityStage(key);
  return { key, label: status.label, status, acceptsCards: key !== "unstaged" };
});

function stageOf(opportunity: Opportunity) {
  const stage = normalizeOpportunityStage(opportunity.sales_stage);
  return STAGE_KEYS.has(stage) ? stage : "unstaged";
}

function isOverdue(opportunity: Opportunity) {
  if (!opportunity.expected_close_date || ["closed_won", "closed_lost"].includes(stageOf(opportunity))) return false;
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
  return (
    <Board
      label="Deals"
      moveFieldLabel="stage"
      columns={COLUMNS}
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
      isLoading={isLoading}
      isRefreshing={isRefreshing}
      hasError={hasError}
      onRetry={onRetry}
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
