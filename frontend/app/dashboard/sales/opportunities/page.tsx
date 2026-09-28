"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Columns3, Plus, RotateCcw, Table2 } from "lucide-react";
import { toast } from "sonner";

import OpportunitiesPipelineBoard from "@/components/opportunities/OpportunitiesPipelineBoard";
import { OpportunityQuickCreate } from "@/components/opportunities/OpportunityQuickCreate";
import OpportunitiesTable from "@/components/opportunities/OpportunitiesTable";
import { orderedStages, selectableStages, UNSTAGED_LABEL } from "@/components/opportunities/opportunityStages";
import { SegmentedControl, SegmentedItem } from "@/components/ui/SegmentedControl";
import { Button } from "@/components/ui/button";
import { StatGroup, StatTile } from "@/components/ui/StatTile";
import { Card } from "@/components/ui/Card";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import { ModuleImportExportControls } from "@/components/ui/ModuleImportExportControls";
import { ModuleListToolbar } from "@/components/ui/ModuleListToolbar";
import { PageShell } from "@/components/ui/PageShell";
import Pagination from "@/components/ui/Pagination";
import { getConditionGroups } from "@/components/ui/SavedViewConditionEditor";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useListDisplay } from "@/hooks/useListDisplay";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useOpportunities, type OpportunitySortState } from "@/hooks/sales/useOpportunities";
import { useOpportunityPipeline } from "@/hooks/sales/useOpportunityPipeline";
import { useSavedViews, type SavedViewFilters } from "@/hooks/useSavedViews";
import { apiFetch } from "@/lib/api";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS, resolveSavedViewFilters, resolveVisibleColumns } from "@/lib/moduleViewConfigs";
import { appendSavedViewFilterParams, buildSavedViewExportPayload, canonicalSavedViewFiltersKey } from "@/lib/savedViewQuery";

type PipelineSummary = { total_count: number; stages: Array<{ stage_key: string; stage_id: number | null; label: string; semantic_type: string; count: number; total_value: number }> };

/**
 * A refused stage move names its reason — the server's own words for a known refusal (an
 * inactive stage, a stage that no longer exists) — and falls back to a generic line otherwise.
 */
function stageMoveErrorMessage(error: unknown) {
  const reason = error instanceof Error ? error.message : "";
  return reason && !/^Failed with \d+$/.test(reason) ? `Deal stage was not changed: ${reason}.` : "Deal stage could not be updated. Try again.";
}

async function fetchPipelineSummary(filters: SavedViewFilters) {
  const params = new URLSearchParams();
  appendSavedViewFilterParams(params, filters);
  const res = await apiFetch(`/sales/opportunities/pipeline-summary?${params.toString()}`);
  if (!res.ok) throw new Error("deal-pipeline-summary-unavailable");
  return res.json() as Promise<PipelineSummary>;
}

export default function OpportunitiesPage() {
  const router = useRouter(); const { modules } = useAccessibleModules(); const { data: customFields = [] } = useModuleCustomFields("sales_opportunities"); const { fields: moduleFields } = useModuleFieldConfigs("sales_opportunities");
  const canCreate = Boolean(modules.find((module) => module.name === "sales_opportunities")?.actions?.can_create);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const quickCreateTriggerRef = useRef<HTMLButtonElement>(null);
  const pipelineQuery = useOpportunityPipeline();
  // The Stage filter offers the tenant's stages by stable key, so a saved view keeps working
  // when a label is renamed. Inactive stages stay listed: old deals can still be filtered.
  const definition = useMemo(() => {
    const base = buildModuleViewDefinition("sales_opportunities", customFields, moduleFields);
    const stages = orderedStages(pipelineQuery.data);
    if (!base || !stages.length) return base;
    return {
      ...base,
      filterFields: base.filterFields.map((field) => field.key === "sales_stage"
        ? { ...field, options: stages.map((stage) => ({ value: stage.key, label: stage.is_active ? stage.label : `${stage.label} (inactive)` })) }
        : field),
    };
  }, [customFields, moduleFields, pipelineQuery.data]); const defaultConfig = definition?.defaultConfig ?? MODULE_VIEW_DEFAULTS.sales_opportunities;
  const { views, selectedViewId, setSelectedViewId, draftConfig, setDraftConfig } = useSavedViews("sales_opportunities", defaultConfig); const visibleColumns = resolveVisibleColumns(definition, draftConfig, defaultConfig); const activeFilters = resolveSavedViewFilters(definition, draftConfig.filters);
  const activeFiltersKey = useMemo(() => canonicalSavedViewFiltersKey(activeFilters), [activeFilters]); const activeSort = useMemo<OpportunitySortState>(() => { const sort = draftConfig.sort; return sort && typeof sort.key === "string" ? { key: sort.key, direction: sort.direction === "desc" ? "desc" : "asc" } : null; }, [draftConfig.sort]);
  // The board groups by stage, so it always asks for the stage even when the table has hidden
  // that column; otherwise every card would land in Unstaged.
  const [displayMode, setDisplayMode] = useListDisplay(["table", "pipeline"]);
  const listColumns = useMemo(
    () => (displayMode === "pipeline" && !visibleColumns.includes("sales_stage") ? [...visibleColumns, "sales_stage"] : visibleColumns),
    [displayMode, visibleColumns],
  );
  const summaryQuery = useQuery({ queryKey: ["sales-opportunities-pipeline-summary", activeFiltersKey], queryFn: () => fetchPipelineSummary(activeFilters), staleTime: 30_000 });
  const { opportunities, page, pageSize, totalPages, totalCount, rangeStart, rangeEnd, isLoading, isFetching, error, goToPage, onPageSizeChange, refresh, updateOpportunityStage } = useOpportunities(listColumns, activeFilters, activeSort);
  const [selectedIds, setSelectedIds] = useState<number[]>([]); const currentPageIds = useMemo(() => opportunities.map((item) => item.opportunity_id), [opportunities]);
  const { allConditions, anyConditions } = getConditionGroups(activeFilters); const activeFilterCount = allConditions.length + anyConditions.length; const hasActiveFilters = Boolean((typeof activeFilters.search === "string" && activeFilters.search.trim()) || activeFilterCount); const clearFilters = () => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search: "", conditions: [], all_conditions: [], any_conditions: [] } }));
  async function changeStage(opportunityId: number, currentStage: string | null | undefined, nextStage: string) { if (currentStage === nextStage) return; try { await updateOpportunityStage(opportunityId, nextStage); toast.success("Deal stage updated."); } catch (error) { toast.error(stageMoveErrorMessage(error)); } }
  // While totals load, the tiles are the pipeline's own active stages, so the row does not
  // reflow when the counts arrive.
  const loadingStages: PipelineSummary["stages"] = [
    ...selectableStages(pipelineQuery.data).map((stage) => ({ stage_key: stage.key, stage_id: stage.id, label: stage.label, semantic_type: String(stage.semantic_type), count: 0, total_value: 0 })),
    { stage_key: "unstaged", stage_id: null, label: UNSTAGED_LABEL, semantic_type: "open", count: 0, total_value: 0 },
  ];
  const stages = summaryQuery.data?.stages ?? loadingStages;

  return <PageShell variant="list" title="Deals">
    <ModuleListToolbar searchValue={typeof activeFilters.search === "string" ? activeFilters.search : ""} onSearchChange={(search) => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search } }))} searchPlaceholder="Search deals" filtersOpen={Boolean(activeFilters.filtersOpen)} activeFilterCount={activeFilterCount} onToggleFilters={() => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, filtersOpen: !current.filters.filtersOpen } }))} columnOptions={definition?.columns ?? []} visibleColumns={visibleColumns} onVisibleColumnsChange={(nextColumns) => setDraftConfig((current) => ({ ...current, visible_columns: nextColumns }))} onClearFilters={clearFilters} selectedCount={selectedIds.length} selectionNoun="deal" onClearSelection={() => setSelectedIds([])} viewControls={<><SavedViewSelector moduleKey="sales_opportunities" views={views} selectedViewId={selectedViewId} onSelect={setSelectedViewId} /><SegmentedControl aria-label="Deal display" value={displayMode} onValueChange={setDisplayMode}><SegmentedItem value="table"><Table2 />Table</SegmentedItem><SegmentedItem value="pipeline"><Columns3 />Pipeline</SegmentedItem></SegmentedControl></>} actionControls={<ModuleImportExportControls importEndpoint="/sales/opportunities/import" exportEndpoint="/sales/opportunities/export" exportMethod="POST" exportBody={buildSavedViewExportPayload(activeFilters)} onImportSuccess={refresh} selectedIds={selectedIds} currentPageIds={currentPageIds} />} primaryAction={canCreate ? <Button ref={quickCreateTriggerRef} type="button" onClick={() => setQuickCreateOpen(true)}><Plus />Create deal</Button> : null} />
    <OpportunityQuickCreate open={quickCreateOpen} onOpenChange={setQuickCreateOpen} returnFocusRef={quickCreateTriggerRef} onCreated={() => refresh()} />
    <InlineSavedViewFilters filterFields={definition?.filterFields ?? []} filters={activeFilters} onChange={(filters) => setDraftConfig((current) => ({ ...current, filters }))} hideHeader />
    {summaryQuery.isError ? (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
        <span>Deal pipeline totals could not be loaded. The deal list remains available.</span>
        <Button type="button" variant="outline" size="sm" disabled={summaryQuery.isFetching} onClick={() => void summaryQuery.refetch()}>
          <RotateCcw />{summaryQuery.isFetching ? "Retrying…" : "Retry totals"}
        </Button>
      </div>
    ) : (
      // 5.7 batch 2: seven bordered boxes at `text-xl` were a metric row under another name. One
      // panel, one group, the stat figure size (§4.7 archetype 5).
      <Card><StatGroup label="Pipeline by stage">{stages.map((stage) => <StatTile key={stage.stage_key} label={stage.label} value={summaryQuery.isLoading ? "—" : stage.count} context={stage.total_value ? new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(stage.total_value) : "No value"} />)}</StatGroup></Card>
    )}
    {displayMode === "table" ? <OpportunitiesTable opportunities={opportunities} isLoading={isLoading} isRefreshing={isFetching && !isLoading} visibleColumns={visibleColumns} columnOptions={definition?.columns ?? []} selectedIds={selectedIds} onToggleRow={(id, checked) => setSelectedIds((current) => checked ? Array.from(new Set([...current, id])) : current.filter((item) => item !== id))} onToggleCurrentPage={(checked) => setSelectedIds((current) => checked ? Array.from(new Set([...current, ...currentPageIds])) : current.filter((id) => !currentPageIds.includes(id)))} sort={activeSort ? { column: activeSort.key, direction: activeSort.direction } : null} onSortChange={(sort) => setDraftConfig((current) => ({ ...current, sort: sort ? { key: sort.column, direction: sort.direction } : null }))} onEdit={(opportunity) => router.push(`/dashboard/sales/opportunities/${opportunity.opportunity_id}`)} hasActiveFilters={hasActiveFilters} hasError={Boolean(error)} onRetry={refresh} onClearFilters={clearFilters} onCreateOpportunity={canCreate ? () => setQuickCreateOpen(true) : undefined} /> : <div className="space-y-3"><p className="text-sm text-copy-muted">Showing loaded records {rangeStart}-{rangeEnd} of {totalCount}. Drag a card to another stage, or use its stage menu for keyboard access.</p><OpportunitiesPipelineBoard opportunities={opportunities} isLoading={isLoading} isRefreshing={isFetching && !isLoading} hasError={Boolean(error)} onRetry={refresh} hasActiveFilters={hasActiveFilters} onClearFilters={clearFilters} onCreate={canCreate ? () => setQuickCreateOpen(true) : undefined} onStageChange={(opportunity, stage) => changeStage(opportunity.opportunity_id, opportunity.sales_stage, stage)} /></div>}
    <Pagination page={page} totalPages={totalPages} totalCount={totalCount} rangeStart={rangeStart} rangeEnd={rangeEnd} pageSize={pageSize} isRefreshing={isFetching && !isLoading} onPageChange={goToPage} onPageSizeChange={onPageSizeChange} />
  </PageShell>;
}
