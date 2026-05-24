"use client";

import Link from "next/link";
import { useMemo } from "react";

import __Modules__Table from "@/components/__modules__/__Modules__Table";
import { Button } from "@/components/ui/button";
import Pagination from "@/components/ui/Pagination";
import SearchBar from "@/components/ui/SearchBar";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { use__Modules__ } from "@/hooks/__area__/use__Modules__";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useSavedViews } from "@/hooks/useSavedViews";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS, resolveSavedViewFilters, resolveVisibleColumns } from "@/lib/moduleViewConfigs";

export default function __Module__ListPage() {
  const { data: customFields = [] } = useModuleCustomFields("__MODULE_KEY__");
  const { fields: moduleFields } = useModuleFieldConfigs("__MODULE_KEY__");
  const definition = useMemo(() => buildModuleViewDefinition("__MODULE_KEY__", customFields, moduleFields), [customFields, moduleFields]);
  const defaultConfig = definition?.defaultConfig ?? MODULE_VIEW_DEFAULTS.__MODULE_KEY__;
  const { views, selectedViewId, setSelectedViewId, draftConfig, setDraftConfig } = useSavedViews("__MODULE_KEY__", defaultConfig);
  const visibleColumns = resolveVisibleColumns(definition, draftConfig, defaultConfig);
  const activeFilters = resolveSavedViewFilters(definition, draftConfig.filters);
  const {
    __modules__,
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
  } = use__Modules__(visibleColumns, activeFilters);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">__display_name__</h1>
          <p className="mt-1 text-sm text-neutral-500">Manage __display_name__ records.</p>
        </div>
        <div className="flex items-center gap-2">
          <SavedViewSelector moduleKey="__MODULE_KEY__" views={views} selectedViewId={selectedViewId} onSelect={setSelectedViewId} />
          <Button asChild><Link href="__route_prefix__/new">Create</Link></Button>
        </div>
      </div>
      <SearchBar
        value={typeof activeFilters?.search === "string" ? activeFilters.search : ""}
        onChange={(value) => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search: value } }))}
        placeholder="Search __display_name__"
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
      <__Modules__Table
        records={__modules__}
        isLoading={isLoading}
        isRefreshing={isFetching && !isLoading}
        visibleColumns={visibleColumns}
        columnOptions={definition?.columns ?? []}
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
