"use client";

import { useDeferredValue, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiFetch } from "@/lib/api";

export type Organization = {
  org_id?: number;
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

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Failed to load organizations";
}

export function useOrganizations(initialPage = 1, initialPageSize = 10) {
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const [searchTerm, setSearchTermState] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const deferredSearchTerm = useDeferredValue(searchTerm);

  const query = useQuery({
    queryKey: ["sales-organizations", page, pageSize, deferredSearchTerm],
    queryFn: () => fetchOrganizations(page, pageSize, deferredSearchTerm),
    placeholderData: keepPreviousData,
  });

  const data = query.data;

  async function createOrganization(payload: Record<string, string>) {
    try {
      setIsCreating(true);
      const res = await apiFetch("/sales/organizations/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? `Failed with ${res.status}`);
      }

      await query.refetch();
      setCreateOpen(false);
      toast.success("Organization created.");
    } catch (error) {
      console.error(error);
      toast.error("Failed to create organization.");
    } finally {
      setIsCreating(false);
    }
  }

  return {
    organizations: data?.results ?? [],
    page: data?.page ?? page,
    pageSize,
    totalPages: data?.total_pages ?? 1,
    totalCount: data?.total_count ?? 0,
    rangeStart: data?.range_start ?? 0,
    rangeEnd: data?.range_end ?? 0,
    isLoading: query.isLoading || query.isFetching,
    error: query.error ? getErrorMessage(query.error) : null,
    searchTerm,
    createOpen,
    isCreating,

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
    setCreateOpen,
    createOrganization,
  };
}
