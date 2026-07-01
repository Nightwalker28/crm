"use client";

import { useMemo } from "react";

import CreateSupportCaseDialog from "@/components/support/CreateSupportCaseDialog";
import SupportCasesHeader from "@/components/support/SupportCasesHeader";
import SupportCasesTable from "@/components/support/SupportCasesTable";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import Pagination from "@/components/ui/Pagination";
import SearchBar from "@/components/ui/SearchBar";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
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

  return (
    <div className="flex flex-col gap-6">
      <SupportCasesHeader
        viewSelector={<SavedViewSelector moduleKey="support_cases" views={views} selectedViewId={selectedViewId} onSelect={setSelectedViewId} />}
        primaryAction={<CreateSupportCaseDialog />}
      />
      <SearchBar value={typeof activeFilters?.search === "string" ? activeFilters.search : ""} onChange={(value) => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search: value } }))} placeholder="Search cases" />
      <InlineSavedViewFilters filterFields={definition?.filterFields ?? []} filters={activeFilters} onChange={(nextFilters) => setDraftConfig((current) => ({ ...current, filters: nextFilters }))} />
      <div className="grid gap-3 sm:grid-cols-3">
        <SupportMetric label="Open" value={summary?.total_open ?? 0} loading={summaryQuery.isLoading} />
        <SupportMetric label="Urgent" value={summary?.urgent_open ?? 0} loading={summaryQuery.isLoading} tone="urgent" />
        <SupportMetric label="Overdue" value={summary?.overdue ?? 0} loading={summaryQuery.isLoading} tone="overdue" />
      </div>
      {error ? (
        <div className="flex justify-between rounded-lg border border-red-700 bg-red-900/40 px-4 py-3 text-sm text-red-200">
          <span>{error}</span>
          <button onClick={refresh} className="underline underline-offset-2">Retry</button>
        </div>
      ) : null}
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
      />
      <Pagination page={page} totalPages={totalPages} totalCount={totalCount} rangeStart={rangeStart} rangeEnd={rangeEnd} pageSize={pageSize} isRefreshing={isFetching && !isLoading} onPageChange={goToPage} onPageSizeChange={onPageSizeChange} />
    </div>
  );
}

function SupportMetric({ label, value, loading, tone = "default" }: { label: string; value: number; loading: boolean; tone?: "default" | "urgent" | "overdue" }) {
  const valueClass = tone === "urgent" ? "text-amber-200" : tone === "overdue" ? "text-red-200" : "text-neutral-100";

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${valueClass}`}>{loading ? "..." : value}</div>
    </div>
  );
}
