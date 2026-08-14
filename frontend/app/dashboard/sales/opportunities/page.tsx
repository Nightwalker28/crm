"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Columns3, Plus, RotateCcw, Table2 } from "lucide-react";
import { toast } from "sonner";

import OpportunitiesPipelineBoard from "@/components/opportunities/OpportunitiesPipelineBoard";
import OpportunitiesTable from "@/components/opportunities/OpportunitiesTable";
import { SegmentedControl, SegmentedItem } from "@/components/ui/SegmentedControl";
import { Button } from "@/components/ui/button";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import { ModuleImportExportControls } from "@/components/ui/ModuleImportExportControls";
import { ModuleListToolbar } from "@/components/ui/ModuleListToolbar";
import { PageShell } from "@/components/ui/PageShell";
import Pagination from "@/components/ui/Pagination";
import { getConditionGroups } from "@/components/ui/SavedViewConditionEditor";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useOpportunities, type OpportunitySortState } from "@/hooks/sales/useOpportunities";
import { useSavedViews, type SavedViewFilters } from "@/hooks/useSavedViews";
import { apiFetch } from "@/lib/api";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS, resolveSavedViewFilters, resolveVisibleColumns } from "@/lib/moduleViewConfigs";
import { appendSavedViewFilterParams, buildSavedViewExportPayload, canonicalSavedViewFiltersKey } from "@/lib/savedViewQuery";

type PipelineSummary = { total_count: number; stages: Array<{ stage_key: string; label: string; count: number; total_value: number }> };
const EMPTY_STAGES: PipelineSummary["stages"] = [
  ["lead", "Lead"], ["qualified", "Qualified"], ["proposal", "Proposal"], ["negotiation", "Negotiation"], ["closed_won", "Closed Won"], ["closed_lost", "Closed Lost"], ["unstaged", "Unstaged"],
].map(([stage_key, label]) => ({ stage_key, label, count: 0, total_value: 0 }));

async function fetchPipelineSummary(filters: SavedViewFilters) {
  const params = new URLSearchParams();
  appendSavedViewFilterParams(params, filters);
  const res = await apiFetch(`/sales/opportunities/pipeline-summary?${params.toString()}`);
  if (!res.ok) throw new Error("deal-pipeline-summary-unavailable");
  return res.json() as Promise<PipelineSummary>;
}

export default function OpportunitiesPage() {
  const router = useRouter(); const { data: customFields = [] } = useModuleCustomFields("sales_opportunities"); const { fields: moduleFields } = useModuleFieldConfigs("sales_opportunities");
  const definition = useMemo(() => buildModuleViewDefinition("sales_opportunities", customFields, moduleFields), [customFields, moduleFields]); const defaultConfig = definition?.defaultConfig ?? MODULE_VIEW_DEFAULTS.sales_opportunities;
  const { views, selectedViewId, setSelectedViewId, draftConfig, setDraftConfig } = useSavedViews("sales_opportunities", defaultConfig); const visibleColumns = resolveVisibleColumns(definition, draftConfig, defaultConfig); const activeFilters = resolveSavedViewFilters(definition, draftConfig.filters);
  const activeFiltersKey = useMemo(() => canonicalSavedViewFiltersKey(activeFilters), [activeFilters]); const activeSort = useMemo<OpportunitySortState>(() => { const sort = draftConfig.sort; return sort && typeof sort.key === "string" ? { key: sort.key, direction: sort.direction === "desc" ? "desc" : "asc" } : null; }, [draftConfig.sort]);
  const summaryQuery = useQuery({ queryKey: ["sales-opportunities-pipeline-summary", activeFiltersKey], queryFn: () => fetchPipelineSummary(activeFilters), staleTime: 30_000 });
  const { opportunities, page, pageSize, totalPages, totalCount, rangeStart, rangeEnd, isLoading, isFetching, error, goToPage, onPageSizeChange, refresh, updateOpportunityStage } = useOpportunities(visibleColumns, activeFilters, activeSort);
  const [selectedIds, setSelectedIds] = useState<number[]>([]); const [displayMode, setDisplayMode] = useState<"table" | "pipeline">("table"); const currentPageIds = useMemo(() => opportunities.map((item) => item.opportunity_id), [opportunities]);
  const { allConditions, anyConditions } = getConditionGroups(activeFilters); const activeFilterCount = allConditions.length + anyConditions.length; const hasActiveFilters = Boolean((typeof activeFilters.search === "string" && activeFilters.search.trim()) || activeFilterCount); const clearFilters = () => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search: "", conditions: [], all_conditions: [], any_conditions: [] } }));
  async function changeStage(opportunityId: number, currentStage: string | null | undefined, nextStage: string) { if (currentStage === nextStage) return; try { await updateOpportunityStage(opportunityId, nextStage); toast.success("Deal stage updated."); } catch { toast.error("Deal stage could not be updated. Try again."); } }
  const stages = summaryQuery.data?.stages ?? EMPTY_STAGES;

  return <PageShell variant="list" title="Deals">
    <ModuleListToolbar searchValue={typeof activeFilters.search === "string" ? activeFilters.search : ""} onSearchChange={(search) => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search } }))} searchPlaceholder="Search deals" filtersOpen={Boolean(activeFilters.filtersOpen)} activeFilterCount={activeFilterCount} onToggleFilters={() => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, filtersOpen: !current.filters.filtersOpen } }))} onClearFilters={clearFilters} selectedCount={selectedIds.length} selectionNoun="deal" onClearSelection={() => setSelectedIds([])} viewControls={<><SavedViewSelector moduleKey="sales_opportunities" views={views} selectedViewId={selectedViewId} onSelect={setSelectedViewId} /><SegmentedControl aria-label="Deal display" value={displayMode} onValueChange={setDisplayMode}><SegmentedItem value="table"><Table2 />Table</SegmentedItem><SegmentedItem value="pipeline"><Columns3 />Pipeline</SegmentedItem></SegmentedControl></>} actionControls={<ModuleImportExportControls importEndpoint="/sales/opportunities/import" exportEndpoint="/sales/opportunities/export" exportMethod="POST" exportBody={buildSavedViewExportPayload(activeFilters)} onImportSuccess={refresh} selectedIds={selectedIds} currentPageIds={currentPageIds} />} primaryAction={<Button asChild><Link href="/dashboard/sales/opportunities/new"><Plus />Add deal</Link></Button>} />
    <InlineSavedViewFilters filterFields={definition?.filterFields ?? []} filters={activeFilters} onChange={(filters) => setDraftConfig((current) => ({ ...current, filters }))} hideHeader />
    {summaryQuery.isError ? (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
        <span>Deal pipeline totals could not be loaded. The deal list remains available.</span>
        <Button type="button" variant="outline" size="sm" disabled={summaryQuery.isFetching} onClick={() => void summaryQuery.refetch()}>
          <RotateCcw />{summaryQuery.isFetching ? "Retrying..." : "Retry totals"}
        </Button>
      </div>
    ) : (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">{stages.map((stage) => <div key={stage.stage_key} className="rounded-[var(--radius-card)] border border-line-default bg-surface px-4 py-3"><div className="text-xs font-medium text-copy-label">{stage.label}</div><div className="mt-2 flex items-end justify-between gap-2"><span className="text-xl font-semibold text-copy-primary">{summaryQuery.isLoading ? "—" : stage.count}</span><span className="text-xs text-copy-muted">{stage.total_value ? new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(stage.total_value) : "No value"}</span></div></div>)}</div>
    )}
    {displayMode === "table" ? <OpportunitiesTable opportunities={opportunities} isLoading={isLoading} isRefreshing={isFetching && !isLoading} visibleColumns={visibleColumns} columnOptions={definition?.columns ?? []} selectedIds={selectedIds} onToggleRow={(id, checked) => setSelectedIds((current) => checked ? Array.from(new Set([...current, id])) : current.filter((item) => item !== id))} onToggleCurrentPage={(checked) => setSelectedIds((current) => checked ? Array.from(new Set([...current, ...currentPageIds])) : current.filter((id) => !currentPageIds.includes(id)))} sort={activeSort ? { column: activeSort.key, direction: activeSort.direction } : null} onSortChange={(sort) => setDraftConfig((current) => ({ ...current, sort: sort ? { key: sort.column, direction: sort.direction } : null }))} onEdit={(opportunity) => router.push(`/dashboard/sales/opportunities/${opportunity.opportunity_id}`)} hasActiveFilters={hasActiveFilters} hasError={Boolean(error)} onRetry={refresh} onClearFilters={clearFilters} /> : <div className="space-y-3"><div className="rounded-[var(--radius-card)] border border-line-default bg-surface px-4 py-3 text-sm text-copy-muted">Showing loaded records {rangeStart}-{rangeEnd} of {totalCount}. Drag a card to another stage, or use its stage menu for keyboard access.</div><OpportunitiesPipelineBoard opportunities={opportunities} isLoading={isLoading} isRefreshing={isFetching && !isLoading} hasError={Boolean(error)} onRetry={refresh} hasActiveFilters={hasActiveFilters} onClearFilters={clearFilters} onEdit={(opportunity) => router.push(`/dashboard/sales/opportunities/${opportunity.opportunity_id}`)} onStageChange={(opportunity, stage) => changeStage(opportunity.opportunity_id, opportunity.sales_stage, stage)} /></div>}
    <Pagination page={page} totalPages={totalPages} totalCount={totalCount} rangeStart={rangeStart} rangeEnd={rangeEnd} pageSize={pageSize} isRefreshing={isFetching && !isLoading} onPageChange={goToPage} onPageSizeChange={onPageSizeChange} />
  </PageShell>;
}
