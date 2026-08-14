"use client";

import { useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";

import { OrganizationQuickCreate } from "@/components/organizations/OrganizationQuickCreate";
import OrganizationsTable from "@/components/organizations/OrganizationsTable";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import { ModuleImportExportControls } from "@/components/ui/ModuleImportExportControls";
import { ModuleListToolbar } from "@/components/ui/ModuleListToolbar";
import { PageShell } from "@/components/ui/PageShell";
import Pagination from "@/components/ui/Pagination";
import { getConditionGroups } from "@/components/ui/SavedViewConditionEditor";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { Button } from "@/components/ui/button";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useOrganizations, type OrganizationSortState } from "@/hooks/sales/useOrganizations";
import { useSavedViews } from "@/hooks/useSavedViews";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS, resolveSavedViewFilters, resolveVisibleColumns } from "@/lib/moduleViewConfigs";
import { buildSavedViewExportPayload } from "@/lib/savedViewQuery";

export default function OrganizationsPage() {
  const { modules } = useAccessibleModules();
  // UI gating only — the create endpoint and the quick_create layout endpoint both enforce this.
  const canCreate = Boolean(modules.find((module) => module.name === "sales_organizations")?.actions?.can_create);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const quickCreateTriggerRef = useRef<HTMLButtonElement>(null);
  const { data: customFields = [] } = useModuleCustomFields("sales_organizations");
  const { fields: moduleFields } = useModuleFieldConfigs("sales_organizations");
  const definition = useMemo(() => buildModuleViewDefinition("sales_organizations", customFields, moduleFields), [customFields, moduleFields]);
  const defaultConfig = definition?.defaultConfig ?? MODULE_VIEW_DEFAULTS.sales_organizations;
  const { views, selectedViewId, setSelectedViewId, draftConfig, setDraftConfig } = useSavedViews("sales_organizations", defaultConfig);
  const visibleColumns = resolveVisibleColumns(definition, draftConfig, defaultConfig);
  const activeFilters = resolveSavedViewFilters(definition, draftConfig.filters);
  const activeSort = useMemo<OrganizationSortState>(() => { const sort = draftConfig.sort; return sort && typeof sort.key === "string" ? { key: sort.key, direction: sort.direction === "desc" ? "desc" : "asc" } : null; }, [draftConfig.sort]);
  const { organizations, page, pageSize, totalPages, totalCount, rangeStart, rangeEnd, isLoading, isFetching, error, goToPage, setPageSize, refresh } = useOrganizations(visibleColumns, activeFilters, activeSort);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const currentPageIds = useMemo(() => organizations.map((org) => org.org_id).filter((id): id is number => typeof id === "number"), [organizations]);
  const { allConditions, anyConditions } = getConditionGroups(activeFilters);
  const activeFilterCount = allConditions.length + anyConditions.length;
  const hasActiveFilters = Boolean((typeof activeFilters.search === "string" && activeFilters.search.trim()) || activeFilterCount);
  const clearFilters = () => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search: "", conditions: [], all_conditions: [], any_conditions: [] } }));

  return <PageShell variant="list" title="Accounts">
    <ModuleListToolbar searchValue={typeof activeFilters.search === "string" ? activeFilters.search : ""} onSearchChange={(search) => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search } }))} searchPlaceholder="Search accounts" filtersOpen={Boolean(activeFilters.filtersOpen)} activeFilterCount={activeFilterCount} onToggleFilters={() => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, filtersOpen: !current.filters.filtersOpen } }))} onClearFilters={clearFilters} selectedCount={selectedIds.length} selectionNoun="account" onClearSelection={() => setSelectedIds([])} viewControls={<SavedViewSelector moduleKey="sales_organizations" views={views} selectedViewId={selectedViewId} onSelect={setSelectedViewId} />} actionControls={<ModuleImportExportControls importEndpoint="/sales/organizations/import" exportEndpoint="/sales/organizations/export" exportMethod="POST" exportBody={buildSavedViewExportPayload(activeFilters)} onImportSuccess={refresh} selectedIds={selectedIds} currentPageIds={currentPageIds} />} primaryAction={canCreate ? <Button ref={quickCreateTriggerRef} type="button" onClick={() => setQuickCreateOpen(true)}><Plus />Create account</Button> : null} />
    <OrganizationQuickCreate
      open={quickCreateOpen}
      onOpenChange={setQuickCreateOpen}
      returnFocusRef={quickCreateTriggerRef}
      // refresh() refetches the query already keyed by the active view, filters, sort, and
      // page, so the list updates without resetting any of them.
      onCreated={() => refresh()}
    />
    <InlineSavedViewFilters filterFields={definition?.filterFields ?? []} filters={activeFilters} onChange={(filters) => setDraftConfig((current) => ({ ...current, filters }))} hideHeader />
    <OrganizationsTable organizations={organizations} isLoading={isLoading} isRefreshing={isFetching && !isLoading} visibleColumns={visibleColumns} columnOptions={definition?.columns ?? []} selectedIds={selectedIds} onToggleRow={(orgId, checked) => setSelectedIds((current) => checked ? Array.from(new Set([...current, orgId])) : current.filter((id) => id !== orgId))} onToggleCurrentPage={(checked) => setSelectedIds((current) => checked ? Array.from(new Set([...current, ...currentPageIds])) : current.filter((id) => !currentPageIds.includes(id)))} hasActiveFilters={hasActiveFilters} hasError={Boolean(error)} onRetry={refresh} onClearFilters={clearFilters} onCreateOrganization={canCreate ? () => setQuickCreateOpen(true) : undefined} sort={activeSort ? { column: activeSort.key, direction: activeSort.direction } : null} onSortChange={(sort) => setDraftConfig((current) => ({ ...current, sort: sort ? { key: sort.column, direction: sort.direction } : null }))} />
    <Pagination page={page} totalPages={totalPages} totalCount={totalCount} rangeStart={rangeStart} rangeEnd={rangeEnd} pageSize={pageSize} isRefreshing={isFetching && !isLoading} onPageChange={goToPage} onPageSizeChange={setPageSize} />
  </PageShell>;
}
