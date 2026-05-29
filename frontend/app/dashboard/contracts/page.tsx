"use client";

import { useMemo } from "react";

import ContractsHeader from "@/components/contracts/ContractsHeader";
import ContractsTable from "@/components/contracts/ContractsTable";
import CreateContractDialog from "@/components/contracts/CreateContractDialog";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import Pagination from "@/components/ui/Pagination";
import SearchBar from "@/components/ui/SearchBar";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { useContracts } from "@/hooks/contracts/useContracts";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useSavedViews } from "@/hooks/useSavedViews";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS, resolveSavedViewFilters, resolveVisibleColumns } from "@/lib/moduleViewConfigs";

export default function ContractsPage() {
  const { fields: moduleFields } = useModuleFieldConfigs("contracts");
  const definition = useMemo(() => buildModuleViewDefinition("contracts", [], moduleFields), [moduleFields]);
  const defaultConfig = definition?.defaultConfig ?? MODULE_VIEW_DEFAULTS.contracts;
  const { views, selectedViewId, setSelectedViewId, draftConfig, setDraftConfig } = useSavedViews("contracts", defaultConfig);
  const visibleColumns = resolveVisibleColumns(definition, draftConfig, defaultConfig);
  const activeFilters = resolveSavedViewFilters(definition, draftConfig.filters);
  const { contracts, page, totalPages, totalCount, rangeStart, rangeEnd, pageSize, onPageSizeChange, isLoading, isFetching, error, goToPage, refresh } = useContracts(visibleColumns, activeFilters);

  return (
    <div className="flex flex-col gap-6">
      <ContractsHeader
        viewSelector={<SavedViewSelector moduleKey="contracts" views={views} selectedViewId={selectedViewId} onSelect={setSelectedViewId} />}
        primaryAction={<CreateContractDialog />}
      />
      <SearchBar value={typeof activeFilters?.search === "string" ? activeFilters.search : ""} onChange={(value) => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search: value } }))} placeholder="Search contracts" />
      <InlineSavedViewFilters filterFields={definition?.filterFields ?? []} filters={activeFilters} onChange={(nextFilters) => setDraftConfig((current) => ({ ...current, filters: nextFilters }))} />
      {error ? (
        <div className="flex justify-between rounded-lg border border-red-700 bg-red-900/40 px-4 py-3 text-sm text-red-200">
          <span>{error}</span>
          <button onClick={refresh} className="underline underline-offset-2">Retry</button>
        </div>
      ) : null}
      <ContractsTable contracts={contracts} isLoading={isLoading} isRefreshing={isFetching && !isLoading} visibleColumns={visibleColumns} columnOptions={definition?.columns ?? []} />
      <Pagination page={page} totalPages={totalPages} totalCount={totalCount} rangeStart={rangeStart} rangeEnd={rangeEnd} pageSize={pageSize} isRefreshing={isFetching && !isLoading} onPageChange={goToPage} onPageSizeChange={onPageSizeChange} />
    </div>
  );
}
