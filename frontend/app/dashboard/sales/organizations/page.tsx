"use client";

import OrganizationsTable from "@/components/organizations/OrganizationsTable";
import CreateOrganizationModal from "@/components/organizations/createOrganizationModal";
import OrganizationsHeader from "@/components/organizations/organizationHeader";
import SearchBar from "@/components/ui/SearchBar";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import Pagination from "@/components/ui/Pagination";
import { useOrganizations } from "@/hooks/sales/useOrganizations";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { useSavedViews } from "@/hooks/useSavedViews";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS } from "@/lib/moduleViewConfigs";
import { useMemo, useState } from "react";

export default function OrganizationsPage() {
  const { data: customFields = [] } = useModuleCustomFields("sales_organizations");
  const definition = useMemo(
    () => buildModuleViewDefinition("sales_organizations", customFields),
    [customFields],
  );
  const {
    views,
    selectedViewId,
    setSelectedViewId,
    draftConfig,
    setDraftConfig,
  } = useSavedViews(
    "sales_organizations",
    MODULE_VIEW_DEFAULTS.sales_organizations,
  );
  const visibleColumns = draftConfig.visible_columns?.length ? draftConfig.visible_columns : MODULE_VIEW_DEFAULTS.sales_organizations.visible_columns;
  const {
    organizations,
    page,
    pageSize,
    totalPages,
    totalCount,
    rangeStart,
    rangeEnd,
    isLoading,
    error,
    goToPage,
    setPageSize,
    refresh,
    createOpen,
    isCreating,
    setCreateOpen,
    createOrganization,
  } = useOrganizations(visibleColumns, draftConfig.filters);
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
        value={typeof draftConfig.filters?.search === "string" ? draftConfig.filters.search : ""}
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
        filters={draftConfig.filters}
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
        visibleColumns={visibleColumns}
        columnOptions={definition?.columns ?? []}
        selectedIds={selectedIds}
        currentPageSelectionState={currentPageSelectionState}
        onToggleRow={toggleRow}
        onToggleCurrentPage={toggleCurrentPage}
      />

      <Pagination
        page={page}
        totalPages={totalPages}
        totalCount={totalCount}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        pageSize={pageSize}
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
