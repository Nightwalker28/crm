"use client";

import { useMemo, useState } from "react";

import CreateQuoteModal from "@/components/quotes/CreateQuoteModal";
import QuotesHeader from "@/components/quotes/QuotesHeader";
import QuotesTable from "@/components/quotes/QuotesTable";
import Pagination from "@/components/ui/Pagination";
import SearchBar from "@/components/ui/SearchBar";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { useQuotes, type QuoteSortState } from "@/hooks/sales/useQuotes";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useSavedViews } from "@/hooks/useSavedViews";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS, resolveSavedViewFilters, resolveVisibleColumns } from "@/lib/moduleViewConfigs";

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
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

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

  return (
    <div className="flex flex-col gap-6">
      <QuotesHeader
        onCreateClick={() => setCreateOpen(true)}
        onImportSuccess={refresh}
        selectedIds={selectedIds}
        currentPageIds={currentPageIds}
        exportFilters={activeFilters}
        viewSelector={<SavedViewSelector moduleKey="sales_quotes" views={views} selectedViewId={selectedViewId} onSelect={setSelectedViewId} />}
      />
      <SearchBar value={typeof activeFilters?.search === "string" ? activeFilters.search : ""} onChange={(value) => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search: value } }))} placeholder="Search quotes" />
      <InlineSavedViewFilters filterFields={definition?.filterFields ?? []} filters={activeFilters} onChange={(nextFilters) => setDraftConfig((current) => ({ ...current, filters: nextFilters }))} />
      {error ? (
        <div className="flex justify-between rounded-lg border border-red-700 bg-red-900/40 px-4 py-3 text-sm text-red-200">
          <span>{error}</span>
          <button onClick={refresh} className="underline underline-offset-2">Retry</button>
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
        sort={activeSort ? { column: activeSort.key, direction: activeSort.direction } : null}
        onSortChange={(nextSort) =>
          setDraftConfig((current) => ({
            ...current,
            sort: nextSort ? { key: nextSort.column, direction: nextSort.direction } : null,
          }))
        }
      />
      <Pagination page={page} totalPages={totalPages} totalCount={totalCount} rangeStart={rangeStart} rangeEnd={rangeEnd} pageSize={pageSize} isRefreshing={isFetching && !isLoading} onPageChange={goToPage} onPageSizeChange={onPageSizeChange} />
      <CreateQuoteModal isOpen={createOpen} onClose={() => setCreateOpen(false)} onSuccess={refresh} />
    </div>
  );
}
