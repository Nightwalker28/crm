"use client";

import { useMemo, useRef, useState } from "react";

import { Plus } from "lucide-react";
import { LeadQuickCreate } from "@/components/leads/LeadQuickCreate";
import LeadsTable from "@/components/leads/LeadsTable";
import Pagination from "@/components/ui/Pagination";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import { ModuleImportExportControls } from "@/components/ui/ModuleImportExportControls";
import { ModuleListToolbar } from "@/components/ui/ModuleListToolbar";
import { getConditionGroups } from "@/components/ui/SavedViewConditionEditor";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { Button } from "@/components/ui/button";
import { useLeads, type LeadSortState } from "@/hooks/sales/useLeads";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useSavedViews } from "@/hooks/useSavedViews";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS, resolveSavedViewFilters, resolveVisibleColumns } from "@/lib/moduleViewConfigs";
import { buildSavedViewExportPayload } from "@/lib/savedViewQuery";

export default function LeadsPage() {
  const { modules } = useAccessibleModules();
  // UI gating only — the create endpoint and the quick_create layout endpoint both enforce this.
  const canCreate = Boolean(modules.find((module) => module.name === "sales_leads")?.actions?.can_create);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const quickCreateTriggerRef = useRef<HTMLButtonElement>(null);
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
    <div className="flex h-full min-h-0 flex-col gap-4">
      <ModuleListToolbar
        searchValue={typeof activeFilters.search === "string" ? activeFilters.search : ""}
        onSearchChange={(value) => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search: value } }))}
        searchPlaceholder="Search leads"
        filtersOpen={Boolean(activeFilters.filtersOpen)}
        activeFilterCount={activeFilterCount}
        onToggleFilters={() => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, filtersOpen: !current.filters.filtersOpen } }))}
        onClearFilters={() => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search: "", conditions: [], all_conditions: [], any_conditions: [] } }))}
        selectedCount={selectedIds.length}
        selectionNoun="lead"
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
        primaryAction={canCreate ? (
          <Button ref={quickCreateTriggerRef} type="button" onClick={() => setQuickCreateOpen(true)}>
            <Plus />Create lead
          </Button>
        ) : null}
      />
      <LeadQuickCreate
        open={quickCreateOpen}
        onOpenChange={setQuickCreateOpen}
        returnFocusRef={quickCreateTriggerRef}
        // refresh() refetches the query already keyed by the active view, filters, sort, and
        // page, so the list updates without resetting any of them.
        onCreated={() => refresh()}
      />
      <InlineSavedViewFilters
        filterFields={definition?.filterFields ?? []}
        filters={activeFilters}
        onChange={(nextFilters) => setDraftConfig((current) => ({ ...current, filters: nextFilters }))}
        hideHeader
      />
      {error ? (
        <div className="flex justify-between rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
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
        onCreateLead={canCreate ? () => setQuickCreateOpen(true) : undefined}
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
