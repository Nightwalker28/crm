"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";

export type Organization = {
  org_name: string;
  primary_email: string;
  secondary_email?: string;
  website?: string;
  primary_phone?: string;
  secondary_phone?: string;
  industry?: string;
  annual_revenue?: string;
};

export type OrganizationsResponse = {
  results: Organization[];
  range_start: number;
  range_end: number;
  total_count: number;
  total_pages: number;
  page: number;
};

async function fetchOrganizations(
  page: number,
  pageSize: number,
  searchTerm: string
): Promise<OrganizationsResponse> {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });

  if (searchTerm.trim()) {
    params.append("search", searchTerm.trim());
  }

  const res = await apiFetch(`/sales/organizations?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed with ${res.status}`);
  return res.json();
}

export function useOrganizations(initialPage = 1, initialPageSize = 10) {
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const [searchTerm, setSearchTermState] = useState("");

  const query = useQuery({
    queryKey: ["sales-organizations", page, pageSize, searchTerm],
    queryFn: () => fetchOrganizations(page, pageSize, searchTerm),
    placeholderData: keepPreviousData,
  });

  const data = query.data;

  return {
    organizations: data?.results ?? [],
    page: data?.page ?? page,
    pageSize,
    totalPages: data?.total_pages ?? 1,
    totalCount: data?.total_count ?? 0,
    rangeStart: data?.range_start ?? 0,
    rangeEnd: data?.range_end ?? 0,
    isLoading: query.isLoading || query.isFetching,
    error: query.error instanceof Error ? "Failed to load organizations" : null,
    searchTerm,

    goToPage: setPage,
    setPageSize: (size: number) => {
      setPage(1);
      setPageSizeState(size);
    },
    refresh: () => query.refetch(),

    setSearchTerm: (value: string) => {
      setPage(1);
      setSearchTermState(value);
    },
  };
}
