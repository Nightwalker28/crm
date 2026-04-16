"use client";

import OrganizationsTable from "@/components/organizations/OrganizationsTable";
import CreateOrganizationModal from "@/components/organizations/createOrganizationModal";
import OrganizationsHeader from "@/components/organizations/organizationHeader";
import SearchBar from "@/components/ui/SearchBar";
import Pagination from "@/components/ui/Pagination";
import { useOrganizations } from "@/hooks/sales/useOrganizations";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { useSavedViews } from "@/hooks/useSavedViews";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS } from "@/lib/moduleViewConfigs";
import { useMemo } from "react";

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

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <OrganizationsHeader
          onCreateClick={() => setCreateOpen(true)}
          onUploadSuccess={refresh}
        />
        <SavedViewSelector
          moduleKey="sales_organizations"
          views={views}
          selectedViewId={selectedViewId}
          onSelect={setSelectedViewId}
        />
      </div>

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
