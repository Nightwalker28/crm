"use client";

import { useMemo, useState } from "react";

import CreateLeadModal from "@/components/leads/CreateLeadModal";
import LeadsHeader from "@/components/leads/LeadsHeader";
import LeadsTable from "@/components/leads/LeadsTable";
import Pagination from "@/components/ui/Pagination";
import SearchBar from "@/components/ui/SearchBar";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { useLeads, type LeadSortState } from "@/hooks/sales/useLeads";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useSavedViews } from "@/hooks/useSavedViews";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS, resolveSavedViewFilters, resolveVisibleColumns } from "@/lib/moduleViewConfigs";

export default function LeadsPage() {
  const { data: customFields = [] } = useModuleCustomFields("sales_leads");
  const { fields: moduleFields } = useModuleFieldConfigs("sales_leads");
  const definition = useMemo(() => buildModuleViewDefinition("sales_leads", customFields, moduleFields), [customFields, moduleFields]);
  const defaultConfig = definition?.defaultConfig ?? MODULE_VIEW_DEFAULTS.sales_leads;
  const { views, selectedViewId, setSelectedViewId, draftConfig, setDraftConfig } = useSavedViews("sales_leads", defaultConfig);
  const visibleColumns = resolveVisibleColumns(definition, draftConfig, defaultConfig);
  const activeFilters = resolveSavedViewFilters(definition, draftConfig.filters);
  const activeSort = useMemo<LeadSortState>(() => {
    const sort = draftConfig.sort;
    if (!sort || typeof sort.key !== "string") return null;
    return {
      key: sort.key,
      direction: sort.direction === "desc" ? "desc" : "asc",
    };
  }, [draftConfig.sort]);
  const {
    leads,
    page,
    totalPages,
    totalCount,
    rangeStart,
    rangeEnd,
    pageSize,
    onPageSizeChange,
    isLoading,
    isFetching,
    error,
    goToPage,
    refresh,
  } = useLeads(visibleColumns, activeFilters, activeSort);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const currentPageIds = useMemo(() => leads.map((lead) => lead.lead_id), [leads]);
  const currentPageSelectionState = useMemo<boolean | "indeterminate">(() => {
    if (!currentPageIds.length) return false;
    const selectedOnPage = currentPageIds.filter((id) => selectedIds.includes(id)).length;
    if (!selectedOnPage) return false;
    if (selectedOnPage === currentPageIds.length) return true;
    return "indeterminate";
  }, [currentPageIds, selectedIds]);

  function toggleRow(leadId: number, checked: boolean) {
    setSelectedIds((current) => checked ? Array.from(new Set([...current, leadId])) : current.filter((id) => id !== leadId));
  }

  function toggleCurrentPage(checked: boolean) {
    setSelectedIds((current) => {
      if (checked) return Array.from(new Set([...current, ...currentPageIds]));
      return current.filter((id) => !currentPageIds.includes(id));
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <LeadsHeader
        onCreateClick={() => setCreateOpen(true)}
        onImportSuccess={refresh}
        selectedIds={selectedIds}
        currentPageIds={currentPageIds}
        exportFilters={activeFilters}
        viewSelector={<SavedViewSelector moduleKey="sales_leads" views={views} selectedViewId={selectedViewId} onSelect={setSelectedViewId} />}
      />
      <SearchBar
        value={typeof activeFilters?.search === "string" ? activeFilters.search : ""}
        onChange={(value) => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search: value } }))}
        placeholder="Search leads"
      />
      <InlineSavedViewFilters
        filterFields={definition?.filterFields ?? []}
        filters={activeFilters}
        onChange={(nextFilters) => setDraftConfig((current) => ({ ...current, filters: nextFilters }))}
      />
      {error ? (
        <div className="flex justify-between rounded-lg border border-red-700 bg-red-900/40 px-4 py-3 text-sm text-red-200">
          <span>{error}</span>
          <button onClick={refresh} className="underline underline-offset-2">Retry</button>
        </div>
      ) : null}
      <LeadsTable
        leads={leads}
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
      <Pagination
        page={page}
        totalPages={totalPages}
        totalCount={totalCount}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        pageSize={pageSize}
        isRefreshing={isFetching && !isLoading}
        onPageChange={goToPage}
        onPageSizeChange={onPageSizeChange}
      />
      <CreateLeadModal isOpen={createOpen} onClose={() => setCreateOpen(false)} onSuccess={refresh} />
    </div>
  );
}
