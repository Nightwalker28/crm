"use client";

import { Pill } from "@/components/ui/Pill";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { Opportunity } from "@/hooks/sales/useOpportunities";
import { formatDateOnly } from "@/lib/datetime";
import {
  getOpportunityStageLabel,
  getOpportunityStageStyle,
  normalizeOpportunityStage,
  OPPORTUNITY_STAGE_ORDER,
} from "@/components/opportunities/opportunityStages";

type Props = {
  opportunities: Opportunity[];
  isLoading: boolean;
  isRefreshing?: boolean;
  onEdit: (opportunity: Opportunity) => void;
  onStageChange: (opportunity: Opportunity, salesStage: string) => void;
};

function formatValue(value?: string | null) {
  return value && value.trim() ? value : "—";
}

export default function OpportunitiesPipelineBoard({
  opportunities,
  isLoading,
  isRefreshing = false,
  onEdit,
  onStageChange,
}: Props) {
  const grouped = new Map<string, Opportunity[]>();

  for (const stage of OPPORTUNITY_STAGE_ORDER) {
    grouped.set(stage, []);
  }
  grouped.set("unstaged", []);

  for (const opportunity of opportunities) {
    const key = normalizeOpportunityStage(opportunity.sales_stage);
    if (grouped.has(key)) {
      grouped.get(key)?.push(opportunity);
    } else {
      grouped.get("unstaged")?.push(opportunity);
    }
  }

  const stageEntries = [...OPPORTUNITY_STAGE_ORDER, "unstaged"].map((stage) => ({
    stage,
    label: stage === "unstaged" ? "Unstaged" : getOpportunityStageLabel(stage),
    items: grouped.get(stage) ?? [],
    style: getOpportunityStageStyle(stage),
  }));

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950/60">
      <div className="border-b border-neutral-800 px-5 py-4">
        <h2 className="text-base font-semibold text-neutral-100">Pipeline View</h2>
        <p className="mt-1 text-sm text-neutral-400">
          Review the currently loaded deal set in a stage-based board while keeping edits in the same flow.
        </p>
      </div>

      {isLoading ? (
        <div className="overflow-x-auto px-4 py-4">
          <div className="flex gap-4 overflow-x-auto">
            {Array.from({ length: 7 }).map((_, index) => (
              <div key={`pipeline-skeleton-${index}`} className="min-w-[220px] flex-shrink-0 rounded-lg border border-neutral-800 bg-black/20">
                <div className="border-b border-neutral-800 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <Skeleton className="h-6 w-24 bg-neutral-800" />
                    <Skeleton className="h-4 w-6 bg-neutral-800" />
                  </div>
                </div>
                <div className="flex min-h-[12rem] flex-col gap-3 p-3">
                  {Array.from({ length: 3 }).map((__, cardIndex) => (
                    <div key={`pipeline-card-${index}-${cardIndex}`} className="rounded-lg border border-neutral-800 bg-neutral-950/80 p-3">
                      <Skeleton className="h-4 w-32 bg-neutral-800" />
                      <Skeleton className="mt-2 h-3 w-24 bg-neutral-800" />
                      <Skeleton className="mt-4 h-3 w-20 bg-neutral-800" />
                      <Skeleton className="mt-2 h-3 w-24 bg-neutral-800" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto px-4 py-4">
          {isRefreshing ? (
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/8 bg-black/60 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-neutral-400">
              <span className="h-2 w-2 rounded-full bg-neutral-400 animate-pulse" />
              Refreshing
            </div>
          ) : null}
          <div className="flex gap-4 overflow-x-auto">
            {stageEntries.map((entry) => (
              <div
                key={entry.stage}
                className="min-w-[220px] flex-shrink-0 rounded-lg border border-neutral-800 bg-black/20"
              >
                <div className="border-b border-neutral-800 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <Pill
                      bg={entry.style.bg}
                      text={entry.style.text}
                      border={entry.style.border}
                    >
                      {entry.label}
                    </Pill>
                    <span className="text-xs text-neutral-500">{entry.items.length}</span>
                  </div>
                </div>

                <div className="flex min-h-[12rem] flex-col gap-3 p-3">
                  {entry.items.length ? (
                    entry.items.map((opportunity) => (
                      <div
                        key={opportunity.opportunity_id}
                        className="rounded-lg border border-neutral-800 bg-neutral-950/80 p-3 text-left transition-colors hover:border-neutral-700 hover:bg-neutral-900"
                      >
                        <button
                          type="button"
                          onClick={() => onEdit(opportunity)}
                          className="w-full text-left text-sm font-medium text-neutral-100 hover:text-white"
                        >
                          {opportunity.opportunity_name}
                        </button>
                        <div className="mt-1 text-sm text-neutral-400">
                          {formatValue(opportunity.client)}
                        </div>
                        <div className="mt-3 text-xs text-neutral-500">
                          Close {opportunity.expected_close_date ? formatDateOnly(opportunity.expected_close_date) : "not set"}
                        </div>
                        <div className="mt-1 text-xs text-neutral-500">
                          Value {formatValue(opportunity.total_cost_of_project)}
                        </div>
                        <div className="mt-3">
                          <Select
                            value={normalizeOpportunityStage(opportunity.sales_stage) || "lead"}
                            onValueChange={(value) => onStageChange(opportunity, value)}
                          >
                            <SelectTrigger className="h-8 w-full text-xs">
                              <SelectValue placeholder="Move stage" />
                            </SelectTrigger>
                            <SelectContent>
                              {OPPORTUNITY_STAGE_ORDER.map((stage) => (
                                <SelectItem key={stage} value={stage}>
                                  {getOpportunityStageLabel(stage)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                            {opportunity.currency_type || "USD"}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-lg border border-dashed border-neutral-800 bg-neutral-950/40 px-3 py-6 text-center text-sm text-neutral-500">
                      No opportunities in this stage.
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
