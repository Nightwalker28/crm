"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Plus } from "lucide-react";

import SupportCasesTable from "@/components/support/SupportCasesTable";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import { ModuleListToolbar } from "@/components/ui/ModuleListToolbar";
import { PageShell } from "@/components/ui/PageShell";
import Pagination from "@/components/ui/Pagination";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { getConditionGroups } from "@/components/ui/SavedViewConditionEditor";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/skeleton";
import { useSupportCases, useSupportCaseSummary, type SupportCaseSortState } from "@/hooks/support/useCases";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useSavedViews } from "@/hooks/useSavedViews";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS, resolveSavedViewFilters, resolveVisibleColumns } from "@/lib/moduleViewConfigs";

export default function SupportCasesPage() {
  const { fields: moduleFields } = useModuleFieldConfigs("support_cases");
  const definition = useMemo(() => buildModuleViewDefinition("support_cases", [], moduleFields), [moduleFields]);
  const defaultConfig = definition?.defaultConfig ?? MODULE_VIEW_DEFAULTS.support_cases;
  const { views, selectedViewId, setSelectedViewId, draftConfig, setDraftConfig } = useSavedViews("support_cases", defaultConfig);
  const visibleColumns = resolveVisibleColumns(definition, draftConfig, defaultConfig);
  const activeFilters = resolveSavedViewFilters(definition, draftConfig.filters);
  const activeSort = useMemo<SupportCaseSortState>(() => {
    const sort = draftConfig.sort;
    if (!sort || typeof sort.key !== "string") return null;
    return {
      key: sort.key,
      direction: sort.direction === "desc" ? "desc" : "asc",
    };
  }, [draftConfig.sort]);
  const { cases, page, totalPages, totalCount, rangeStart, rangeEnd, pageSize, onPageSizeChange, isLoading, isFetching, error, goToPage, refresh } = useSupportCases(visibleColumns, activeFilters, activeSort);
  const summaryQuery = useSupportCaseSummary();
  const summary = summaryQuery.data;
  const { allConditions, anyConditions } = getConditionGroups(activeFilters);
  const activeFilterCount = allConditions.length + anyConditions.length;
  const hasActiveFilters = activeFilterCount > 0 || Boolean(
    typeof activeFilters.search === "string" && activeFilters.search.trim(),
  );

  function clearFilters() {
    setDraftConfig((current) => ({
      ...current,
      filters: {
        ...current.filters,
        search: "",
        conditions: [],
        all_conditions: [],
        any_conditions: [],
      },
    }));
  }

  return (
    <PageShell variant="list" title="Support cases">
      <ModuleListToolbar
        searchValue={typeof activeFilters?.search === "string" ? activeFilters.search : ""}
        onSearchChange={(search) => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search } }))}
        searchPlaceholder="Search support cases"
        filtersOpen={Boolean(activeFilters.filtersOpen)}
        activeFilterCount={activeFilterCount}
        onToggleFilters={() => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, filtersOpen: !current.filters.filtersOpen } }))}
        onClearFilters={clearFilters}
        viewControls={<SavedViewSelector moduleKey="support_cases" views={views} selectedViewId={selectedViewId} onSelect={setSelectedViewId} />}
        primaryAction={<Button asChild><Link href="/dashboard/support/cases/new"><Plus />New case</Link></Button>}
      />

      <InlineSavedViewFilters filterFields={definition?.filterFields ?? []} filters={activeFilters} onChange={(nextFilters) => setDraftConfig((current) => ({ ...current, filters: nextFilters }))} hideHeader />

      {summaryQuery.isError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-state-warning/40 bg-state-warning-muted px-4 py-3 text-sm text-copy-primary">
          <span>Case totals are temporarily unavailable. The case list is still current.</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void summaryQuery.refetch()}>Retry totals</Button>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <SupportMetric label="Open" value={summary?.total_open} loading={summaryQuery.isLoading} />
        <SupportMetric label="Urgent" value={summary?.urgent_open} loading={summaryQuery.isLoading} tone="urgent" />
        <SupportMetric label="Overdue" value={summary?.overdue} loading={summaryQuery.isLoading} tone="overdue" />
      </div>
      <SupportCasesTable
        cases={cases}
        isLoading={isLoading}
        isRefreshing={isFetching && !isLoading}
        visibleColumns={visibleColumns}
        columnOptions={definition?.columns ?? []}
        sort={activeSort ? { column: activeSort.key, direction: activeSort.direction } : null}
        onSortChange={(nextSort) =>
          setDraftConfig((current) => ({
            ...current,
            sort: nextSort ? { key: nextSort.column, direction: nextSort.direction } : null,
          }))
        }
        isFiltered={hasActiveFilters}
        hasError={Boolean(error)}
        onRetry={() => void refresh()}
      />
      <Pagination page={page} totalPages={totalPages} totalCount={totalCount} rangeStart={rangeStart} rangeEnd={rangeEnd} pageSize={pageSize} isRefreshing={isFetching && !isLoading} onPageChange={goToPage} onPageSizeChange={onPageSizeChange} />
    </PageShell>
  );
}

function SupportMetric({ label, value, loading, tone = "default" }: { label: string; value?: number; loading: boolean; tone?: "default" | "urgent" | "overdue" }) {
  const valueClass = tone === "urgent" ? "text-state-warning" : tone === "overdue" ? "text-state-danger" : "text-copy-primary";

  return (
    <Card className="px-4 py-3">
      <div className="text-xs font-medium text-copy-label">{label}</div>
      {loading ? <Skeleton className="mt-2 h-8 w-14" /> : <div className={`mt-2 text-2xl font-semibold ${valueClass}`}>{value ?? "—"}</div>}
    </Card>
  );
}
