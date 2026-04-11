"use client";

import OrganizationCard from "@/components/organizations/organizationCard";
import OrganizationsHeader from "@/components/organizations/organizationHeader";
import SearchBar from "@/components/ui/SearchBar";
import Pagination from "@/components/ui/Pagination";
import { useOrganizations } from "@/hooks/sales/useOrganizations";

export default function OrganizationsPage() {
  const {
    organizations,
    page,
    pageSize,
    totalPages,
    totalCount,
    rangeStart,
    rangeEnd,
    error,
    searchTerm,
    setSearchTerm,
    goToPage,
    setPageSize,
    refresh,
  } = useOrganizations();

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">
      <OrganizationsHeader
        onCreateClick={() => console.log("Create organization")}
        onUploadSuccess={refresh}
      />

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

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {organizations.map((org) => (
          <OrganizationCard
            key={`${org.org_name}-${org.primary_email}`}
            org={org}
          />
        ))}
      </div>

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
    </div>
  );
}