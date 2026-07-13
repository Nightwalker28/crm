"use client";

import { useMemo, useState } from "react";

import LeadsHeader from "@/components/leads/LeadsHeader";
import LeadsTable from "@/components/leads/LeadsTable";
import Pagination from "@/components/ui/Pagination";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import { ModuleImportExportControls } from "@/components/ui/ModuleImportExportControls";
import { ModuleListToolbar } from "@/components/ui/ModuleListToolbar";
import { getConditionGroups } from "@/components/ui/SavedViewConditionEditor";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { useLeads, type LeadSortState } from "@/hooks/sales/useLeads";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useSavedViews } from "@/hooks/useSavedViews";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS, resolveSavedViewFilters, resolveVisibleColumns } from "@/lib/moduleViewConfigs";
import { buildSavedViewExportPayload } from "@/lib/savedViewQuery";

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
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const { allConditions, anyConditions } = getConditionGroups(activeFilters);
  const activeFilterCount = allConditions.length + anyConditions.length;
  const hasActiveFilters = Boolean((typeof activeFilters.search === "string" && activeFilters.search.trim()) || activeFilterCount);

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
      <LeadsHeader eyebrow={totalCount ? `${totalCount} lead${totalCount === 1 ? "" : "s"} in this view` : undefined} />
      <ModuleListToolbar
        searchValue={typeof activeFilters.search === "string" ? activeFilters.search : ""}
        onSearchChange={(value) => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search: value } }))}
        searchPlaceholder="Search leads"
        filtersOpen={Boolean(activeFilters.filtersOpen)}
        activeFilterCount={activeFilterCount}
        onToggleFilters={() => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, filtersOpen: !current.filters.filtersOpen } }))}
        onClearFilters={() => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search: "", conditions: [], all_conditions: [], any_conditions: [] } }))}
        selectedCount={selectedIds.length}
        onClearSelection={() => setSelectedIds([])}
        viewControls={<SavedViewSelector moduleKey="sales_leads" views={views} selectedViewId={selectedViewId} onSelect={setSelectedViewId} />}
        actionControls={(
          <ModuleImportExportControls
            importEndpoint="/sales/leads/import"
            exportEndpoint="/sales/leads/export"
            exportMethod="POST"
            exportBody={buildSavedViewExportPayload(activeFilters)}
            onImportSuccess={refresh}
            selectedIds={selectedIds}
            currentPageIds={currentPageIds}
          />
        )}
      />
      <InlineSavedViewFilters
        filterFields={definition?.filterFields ?? []}
        filters={activeFilters}
        onChange={(nextFilters) => setDraftConfig((current) => ({ ...current, filters: nextFilters }))}
        hideHeader
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
        hasActiveFilters={hasActiveFilters}
        onClearFilters={() => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search: "", conditions: [], all_conditions: [], any_conditions: [] } }))}
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
    </div>
  );
}
