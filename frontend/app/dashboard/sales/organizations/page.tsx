"use client";

import OrganizationsTable from "@/components/organizations/OrganizationsTable";
import CreateOrganizationModal from "@/components/organizations/createOrganizationModal";
import OrganizationsHeader from "@/components/organizations/organizationHeader";
import SearchBar from "@/components/ui/SearchBar";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import Pagination from "@/components/ui/Pagination";
import { useOrganizations, type OrganizationSortState } from "@/hooks/sales/useOrganizations";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { useSavedViews } from "@/hooks/useSavedViews";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS, resolveSavedViewFilters, resolveVisibleColumns } from "@/lib/moduleViewConfigs";
import { useMemo, useState } from "react";

export default function OrganizationsPage() {
  const { data: customFields = [] } = useModuleCustomFields("sales_organizations");
  const { fields: moduleFields } = useModuleFieldConfigs("sales_organizations");
  const definition = useMemo(
    () => buildModuleViewDefinition("sales_organizations", customFields, moduleFields),
    [customFields, moduleFields],
  );
  const defaultConfig = definition?.defaultConfig ?? MODULE_VIEW_DEFAULTS.sales_organizations;
  const {
    views,
    selectedViewId,
    setSelectedViewId,
    draftConfig,
    setDraftConfig,
  } = useSavedViews(
    "sales_organizations",
    defaultConfig,
  );
  const visibleColumns = resolveVisibleColumns(definition, draftConfig, defaultConfig);
  const activeFilters = resolveSavedViewFilters(definition, draftConfig.filters);
  const activeSort = useMemo<OrganizationSortState>(() => {
    const sort = draftConfig.sort;
    if (!sort || typeof sort.key !== "string") return null;
    return {
      key: sort.key,
      direction: sort.direction === "desc" ? "desc" : "asc",
    };
  }, [draftConfig.sort]);
  const {
    organizations,
    page,
    pageSize,
    totalPages,
    totalCount,
    rangeStart,
    rangeEnd,
    isLoading,
    isFetching,
    error,
    goToPage,
    setPageSize,
    refresh,
    createOpen,
    isCreating,
    setCreateOpen,
    createOrganization,
  } = useOrganizations(visibleColumns, activeFilters, activeSort);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const currentPageIds = useMemo(
    () => organizations.map((org) => org.org_id).filter((id): id is number => typeof id === "number"),
    [organizations],
  );
  const currentPageSelectionState = useMemo<boolean | "indeterminate">(() => {
    if (!currentPageIds.length) return false;
    const selectedOnPage = currentPageIds.filter((id) => selectedIds.includes(id)).length;
    if (!selectedOnPage) return false;
    if (selectedOnPage === currentPageIds.length) return true;
    return "indeterminate";
  }, [currentPageIds, selectedIds]);

  function toggleRow(orgId: number, checked: boolean) {
    setSelectedIds((current) =>
      checked ? Array.from(new Set([...current, orgId])) : current.filter((id) => id !== orgId),
    );
  }

  function toggleCurrentPage(checked: boolean) {
    setSelectedIds((current) => {
      if (checked) {
        return Array.from(new Set([...current, ...currentPageIds]));
      }
      return current.filter((id) => !currentPageIds.includes(id));
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <OrganizationsHeader
        onCreateClick={() => setCreateOpen(true)}
        onImportSuccess={refresh}
        selectedIds={selectedIds}
        currentPageIds={currentPageIds}
        exportFilters={activeFilters}
        viewSelector={
          <SavedViewSelector
          moduleKey="sales_organizations"
          views={views}
          selectedViewId={selectedViewId}
          onSelect={setSelectedViewId}
          />
        }
      />

      <SearchBar
        value={typeof activeFilters?.search === "string" ? activeFilters.search : ""}
        onChange={(value) =>
          setDraftConfig((current) => ({
            ...current,
            filters: {
              ...current.filters,
              search: value,
            },
          }))
        }
        placeholder="Search"
      />

      <InlineSavedViewFilters
        filterFields={definition?.filterFields ?? []}
        filters={activeFilters}
        onChange={(nextFilters) =>
          setDraftConfig((current) => ({
            ...current,
            filters: nextFilters,
          }))
        }
      />

      {error && (
        <div className="bg-red-900/40 border border-red-700 text-red-200 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      <OrganizationsTable
        organizations={organizations}
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
        onPageSizeChange={setPageSize}
      />

      <CreateOrganizationModal
        isOpen={createOpen}
        isSubmitting={isCreating}
        onClose={() => setCreateOpen(false)}
        onCreate={createOrganization}
      />
    </div>
  );
}
