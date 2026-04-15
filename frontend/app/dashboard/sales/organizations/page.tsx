"use client";

import OrganizationsTable from "@/components/organizations/OrganizationsTable";
import CreateOrganizationModal from "@/components/organizations/createOrganizationModal";
import OrganizationsHeader from "@/components/organizations/organizationHeader";
import SearchBar from "@/components/ui/SearchBar";
import Pagination from "@/components/ui/Pagination";
import { useOrganizations } from "@/hooks/sales/useOrganizations";
import { ColumnPicker } from "@/components/ui/ColumnPicker";
import { useTablePreferences } from "@/hooks/useTablePreferences";

const ORGANIZATION_COLUMNS = [
  { key: "org_name", label: "Organization" },
  { key: "primary_email", label: "Email" },
  { key: "website", label: "Website" },
  { key: "industry", label: "Industry" },
  { key: "annual_revenue", label: "Revenue" },
  { key: "primary_phone", label: "Phone" },
  { key: "billing_country", label: "Country" },
];

const DEFAULT_ORGANIZATION_COLUMNS = ["org_name", "primary_email", "website", "industry"];

export default function OrganizationsPage() {
  const { visibleColumns, saveVisibleColumns } = useTablePreferences(
    "sales_organizations",
    ORGANIZATION_COLUMNS,
    DEFAULT_ORGANIZATION_COLUMNS,
  );
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
    searchTerm,
    setSearchTerm,
    goToPage,
    setPageSize,
    refresh,
    createOpen,
    isCreating,
    setCreateOpen,
    createOrganization,
  } = useOrganizations(visibleColumns);

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <OrganizationsHeader
          onCreateClick={() => setCreateOpen(true)}
          onUploadSuccess={refresh}
        />
        <ColumnPicker
          title="Organization columns"
          options={ORGANIZATION_COLUMNS}
          visibleColumns={visibleColumns}
          onChange={saveVisibleColumns}
        />
      </div>

      <SearchBar
        value={searchTerm}
        onChange={setSearchTerm}
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
