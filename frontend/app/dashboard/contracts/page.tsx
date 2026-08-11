"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

import ContractsTable from "@/components/contracts/ContractsTable";
import { Button } from "@/components/ui/button";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import { ModuleListToolbar } from "@/components/ui/ModuleListToolbar";
import Pagination from "@/components/ui/Pagination";
import { PermissionDeniedState } from "@/components/ui/PermissionDeniedState";
import { RouteLoadingState } from "@/components/ui/RouteStates";
import { getConditionGroups } from "@/components/ui/SavedViewConditionEditor";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { useContracts, type ContractSortState } from "@/hooks/contracts/useContracts";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useSavedViews } from "@/hooks/useSavedViews";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS, resolveSavedViewFilters, resolveVisibleColumns } from "@/lib/moduleViewConfigs";

export default function ContractsPage() {
  const { modules, isLoading: modulesLoading } = useAccessibleModules();
  const accessibleModule = modules.find((module) => module.name === "contracts");
  const canCreate = Boolean(accessibleModule?.actions?.can_create);
  const { fields: moduleFields } = useModuleFieldConfigs("contracts");
  const definition = useMemo(() => buildModuleViewDefinition("contracts", [], moduleFields), [moduleFields]);
  const defaultConfig = definition?.defaultConfig ?? MODULE_VIEW_DEFAULTS.contracts;
  const { views, selectedViewId, setSelectedViewId, draftConfig, setDraftConfig } = useSavedViews("contracts", defaultConfig);
  const visibleColumns = resolveVisibleColumns(definition, draftConfig, defaultConfig);
  const activeFilters = resolveSavedViewFilters(definition, draftConfig.filters);
  const [sort, setSort] = useState<ContractSortState>(null);
  const { contracts, page, totalPages, totalCount, rangeStart, rangeEnd, pageSize, onPageSizeChange, isLoading, isFetching, error, goToPage, refresh } = useContracts(visibleColumns, activeFilters, sort);
  const { allConditions, anyConditions } = getConditionGroups(activeFilters);
  const activeFilterCount = allConditions.length + anyConditions.length;
  const hasActiveFilters = Boolean(
    (typeof activeFilters.search === "string" && activeFilters.search.trim()) || activeFilterCount,
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

  if (modulesLoading) {
    return <RouteLoadingState label="contracts" />;
  }

  if (!accessibleModule?.actions?.can_view) {
    return <PermissionDeniedState />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <ModuleListToolbar
        searchValue={typeof activeFilters.search === "string" ? activeFilters.search : ""}
        onSearchChange={(search) => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search } }))}
        searchPlaceholder="Search contracts"
        filtersOpen={Boolean(activeFilters.filtersOpen)}
        activeFilterCount={activeFilterCount}
        onToggleFilters={() => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, filtersOpen: !current.filters.filtersOpen } }))}
        onClearFilters={clearFilters}
        viewControls={<SavedViewSelector moduleKey="contracts" views={views} selectedViewId={selectedViewId} onSelect={setSelectedViewId} />}
        primaryAction={canCreate ? <Button asChild><Link href="/dashboard/contracts/new"><Plus />New Contract</Link></Button> : undefined}
      />
      <InlineSavedViewFilters filterFields={definition?.filterFields ?? []} filters={activeFilters} onChange={(nextFilters) => setDraftConfig((current) => ({ ...current, filters: nextFilters }))} hideHeader />
      {error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
          <span>Contracts could not be loaded. Check your connection and try again.</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>Try again</Button>
        </div>
      ) : null}
      <ContractsTable contracts={contracts} isLoading={isLoading} isRefreshing={isFetching && !isLoading} visibleColumns={visibleColumns} columnOptions={definition?.columns ?? []} sort={sort} onSortChange={setSort} hasActiveFilters={hasActiveFilters} hasError={Boolean(error)} canCreate={canCreate} onClearFilters={clearFilters} />
      {!error ? <Pagination page={page} totalPages={totalPages} totalCount={totalCount} rangeStart={rangeStart} rangeEnd={rangeEnd} pageSize={pageSize} isRefreshing={isFetching && !isLoading} onPageChange={goToPage} onPageSizeChange={onPageSizeChange} /> : null}
    </div>
  );
}
