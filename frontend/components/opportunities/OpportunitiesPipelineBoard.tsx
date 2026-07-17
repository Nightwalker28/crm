"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, GripVertical } from "lucide-react";
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
  onStageChange: (opportunity: Opportunity, salesStage: string) => Promise<void> | void;
};

function formatValue(value?: string | null) {
  return value && value.trim() ? value : "—";
}

function parseDealValue(value?: string | null) { const parsed = Number((value ?? "").replace(/,/g, "")); return Number.isFinite(parsed) ? parsed : 0; }
function isOverdue(opportunity: Opportunity) { if (!opportunity.expected_close_date || ["closed_won", "closed_lost"].includes(normalizeOpportunityStage(opportunity.sales_stage))) return false; return new Date(`${opportunity.expected_close_date}T23:59:59`).getTime() < Date.now(); }

export default function OpportunitiesPipelineBoard({
  opportunities,
  isLoading,
  isRefreshing = false,
  onEdit,
  onStageChange,
}: Props) {
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dropStage, setDropStage] = useState<string | null>(null);
  const largeDealFloor = useMemo(() => { const values = opportunities.map((item) => parseDealValue(item.total_cost_of_project)).filter((value) => value > 0).sort((a, b) => a - b); return values.length >= 4 ? values[Math.floor(values.length * 0.75)] : Number.POSITIVE_INFINITY; }, [opportunities]);
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
    <div className="rounded-[var(--radius-panel)] border border-line-default bg-surface">
      <div className="border-b border-line-subtle px-5 py-4">
        <h2 className="text-base font-semibold text-copy-primary">Pipeline View</h2>
        <p className="mt-1 text-sm text-copy-muted">
          Review the currently loaded deal set in a stage-based board while keeping edits in the same flow.
        </p>
      </div>

      {isLoading ? (
        <div className="overflow-x-auto px-4 py-4">
          <div className="flex gap-4 overflow-x-auto">
            {Array.from({ length: 7 }).map((_, index) => (
              <div key={`pipeline-skeleton-${index}`} className="min-w-[220px] flex-shrink-0 rounded-[var(--radius-card)] border border-line-default bg-surface-muted">
                <div className="border-b border-line-subtle px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <Skeleton className="h-6 w-24" />
                    <Skeleton className="h-4 w-6" />
                  </div>
                </div>
                <div className="flex min-h-[12rem] flex-col gap-3 p-3">
                  {Array.from({ length: 3 }).map((__, cardIndex) => (
                    <div key={`pipeline-card-${index}-${cardIndex}`} className="rounded-[var(--radius-card)] border border-line-default bg-surface p-3">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="mt-2 h-3 w-24" />
                      <Skeleton className="mt-4 h-3 w-20" />
                      <Skeleton className="mt-2 h-3 w-24" />
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
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-line-subtle bg-surface-muted px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-copy-muted">
              <span className="h-2 w-2 animate-pulse rounded-full bg-copy-muted motion-reduce:animate-none" />
              Refreshing
            </div>
          ) : null}
          <div className="flex gap-4 overflow-x-auto">
            {stageEntries.map((entry) => (
              <div
                key={entry.stage}
                onDragOver={(event) => { event.preventDefault(); setDropStage(entry.stage); }}
                onDragLeave={() => setDropStage((current) => current === entry.stage ? null : current)}
                onDrop={() => { const opportunity = opportunities.find((item) => item.opportunity_id === draggedId); setDropStage(null); setDraggedId(null); if (opportunity && entry.stage !== "unstaged" && normalizeOpportunityStage(opportunity.sales_stage) !== entry.stage) void onStageChange(opportunity, entry.stage); }}
                className={`min-w-[240px] flex-shrink-0 rounded-[var(--radius-card)] border bg-surface-muted transition-colors motion-reduce:transition-none ${dropStage === entry.stage ? "border-action-primary bg-action-primary-muted/30" : "border-line-default"}`}
              >
                <div className="border-b border-line-subtle px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <Pill
                      bg={entry.style.bg}
                      text={entry.style.text}
                      border={entry.style.border}
                    >
                      {entry.label}
                    </Pill>
                    <span className="text-xs text-copy-muted">{entry.items.length}</span>
                  </div>
                </div>

                <div className="flex min-h-[12rem] flex-col gap-3 p-3">
                  {entry.items.length ? (
                    entry.items.map((opportunity) => (
                      <div
                        key={opportunity.opportunity_id}
                        draggable
                        onDragStart={() => setDraggedId(opportunity.opportunity_id)}
                        onDragEnd={() => { setDraggedId(null); setDropStage(null); }}
                        className={`rounded-[var(--radius-card)] border bg-surface p-3 text-left transition-colors hover:border-line-strong hover:bg-surface-raised motion-reduce:transition-none ${isOverdue(opportunity) ? "border-state-warning/50" : parseDealValue(opportunity.total_cost_of_project) >= largeDealFloor ? "border-state-info/50" : "border-line-default"}`}
                      >
                        <div className="flex items-start gap-2"><GripVertical className="mt-0.5 h-4 w-4 shrink-0 cursor-grab text-copy-muted" aria-hidden="true" /><button
                          type="button"
                          onClick={() => onEdit(opportunity)}
                          className="w-full text-left text-sm font-medium text-copy-primary hover:text-action-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          {opportunity.opportunity_name}
                        </button></div>
                        <div className="mt-1 text-sm text-copy-muted">
                          {formatValue(opportunity.organization_name || opportunity.client)}
                        </div>
                        <div className="mt-2 text-xs text-copy-muted">Owner {opportunity.assigned_to_name || "Unassigned"}</div>
                        <div className="mt-3 text-xs text-copy-muted">
                          Close {opportunity.expected_close_date ? formatDateOnly(opportunity.expected_close_date) : "not set"}
                        </div>
                        <div className="mt-1 text-xs text-copy-muted">
                          Value {formatValue(opportunity.total_cost_of_project)}
                        </div>
                        {isOverdue(opportunity) ? <div className="mt-2 flex items-center gap-1 text-xs text-state-warning"><AlertTriangle className="h-3.5 w-3.5" />Overdue</div> : parseDealValue(opportunity.total_cost_of_project) >= largeDealFloor ? <div className="mt-2 text-xs text-state-info">High-value deal</div> : null}
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
                          <span className="text-[11px] uppercase tracking-[0.14em] text-copy-muted">
                            {opportunity.currency_type || "USD"}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-[var(--radius-card)] border border-dashed border-line-default bg-surface px-3 py-6 text-center text-sm text-copy-muted">
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
