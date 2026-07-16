"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

import QuotesTable from "@/components/quotes/QuotesTable";
import Pagination from "@/components/ui/Pagination";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import { ModuleImportExportControls } from "@/components/ui/ModuleImportExportControls";
import { ModuleListToolbar } from "@/components/ui/ModuleListToolbar";
import { PageHeader } from "@/components/ui/PageHeader";
import { getConditionGroups } from "@/components/ui/SavedViewConditionEditor";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { Button } from "@/components/ui/button";
import { useQuotes, type QuoteSortState } from "@/hooks/sales/useQuotes";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useSavedViews } from "@/hooks/useSavedViews";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS, resolveSavedViewFilters, resolveVisibleColumns } from "@/lib/moduleViewConfigs";
import { buildSavedViewExportPayload } from "@/lib/savedViewQuery";

export default function QuotesPage() {
  const { data: customFields = [] } = useModuleCustomFields("sales_quotes");
  const { fields: moduleFields } = useModuleFieldConfigs("sales_quotes");
  const definition = useMemo(() => buildModuleViewDefinition("sales_quotes", customFields, moduleFields), [customFields, moduleFields]);
  const defaultConfig = definition?.defaultConfig ?? MODULE_VIEW_DEFAULTS.sales_quotes;
  const { views, selectedViewId, setSelectedViewId, draftConfig, setDraftConfig } = useSavedViews("sales_quotes", defaultConfig);
  const visibleColumns = resolveVisibleColumns(definition, draftConfig, defaultConfig);
  const activeFilters = resolveSavedViewFilters(definition, draftConfig.filters);
  const activeSort = useMemo<QuoteSortState>(() => {
    const sort = draftConfig.sort;
    if (!sort || typeof sort.key !== "string") return null;
    return {
      key: sort.key,
      direction: sort.direction === "desc" ? "desc" : "asc",
    };
  }, [draftConfig.sort]);
  const { quotes, page, totalPages, totalCount, rangeStart, rangeEnd, pageSize, onPageSizeChange, isLoading, isFetching, error, goToPage, refresh } = useQuotes(visibleColumns, activeFilters, activeSort);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const { allConditions, anyConditions } = getConditionGroups(activeFilters);
  const activeFilterCount = allConditions.length + anyConditions.length;
  const hasActiveFilters = Boolean((typeof activeFilters.search === "string" && activeFilters.search.trim()) || activeFilterCount);

  const currentPageIds = useMemo(() => quotes.map((quote) => quote.quote_id), [quotes]);
  const currentPageSelectionState = useMemo<boolean | "indeterminate">(() => {
    if (!currentPageIds.length) return false;
    const selectedOnPage = currentPageIds.filter((id) => selectedIds.includes(id)).length;
    if (!selectedOnPage) return false;
    if (selectedOnPage === currentPageIds.length) return true;
    return "indeterminate";
  }, [currentPageIds, selectedIds]);

  function toggleRow(quoteId: number, checked: boolean) {
    setSelectedIds((current) => checked ? Array.from(new Set([...current, quoteId])) : current.filter((id) => id !== quoteId));
  }

  function toggleCurrentPage(checked: boolean) {
    setSelectedIds((current) => checked ? Array.from(new Set([...current, ...currentPageIds])) : current.filter((id) => !currentPageIds.includes(id)));
  }

  function clearFilters() {
    setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search: "", conditions: [], all_conditions: [], any_conditions: [] } }));
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Quotes" description="Prepare customer quotes before they become orders or invoices." eyebrow={totalCount ? `${totalCount} quote${totalCount === 1 ? "" : "s"} in this view` : undefined} actions={<Button asChild><Link href="/dashboard/sales/quotes/new"><Plus />Create quote</Link></Button>} />
      <ModuleListToolbar searchValue={typeof activeFilters.search === "string" ? activeFilters.search : ""} onSearchChange={(search) => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search } }))} searchPlaceholder="Search quotes" filtersOpen={Boolean(activeFilters.filtersOpen)} activeFilterCount={activeFilterCount} onToggleFilters={() => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, filtersOpen: !current.filters.filtersOpen } }))} onClearFilters={clearFilters} selectedCount={selectedIds.length} selectionNoun="quote" onClearSelection={() => setSelectedIds([])} viewControls={<SavedViewSelector moduleKey="sales_quotes" views={views} selectedViewId={selectedViewId} onSelect={setSelectedViewId} />} actionControls={<ModuleImportExportControls importEndpoint="/sales/quotes/import" exportEndpoint="/sales/quotes/export" exportMethod="POST" exportBody={buildSavedViewExportPayload(activeFilters)} onImportSuccess={refresh} selectedIds={selectedIds} currentPageIds={currentPageIds} />} />
      <InlineSavedViewFilters filterFields={definition?.filterFields ?? []} filters={activeFilters} onChange={(nextFilters) => setDraftConfig((current) => ({ ...current, filters: nextFilters }))} hideHeader />
      {error ? (
        <div role="alert" className="flex justify-between rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
          <span>We could not load quotes.</span>
          <button onClick={refresh} className="underline underline-offset-2">Try again</button>
        </div>
      ) : null}
      <QuotesTable
        quotes={quotes}
        isLoading={isLoading}
        isRefreshing={isFetching && !isLoading}
        visibleColumns={visibleColumns}
        columnOptions={definition?.columns ?? []}
        selectedIds={selectedIds}
        currentPageSelectionState={currentPageSelectionState}
        onToggleRow={toggleRow}
        onToggleCurrentPage={toggleCurrentPage}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={clearFilters}
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
