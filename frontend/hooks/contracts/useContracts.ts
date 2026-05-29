"use client";

import { apiFetch } from "@/lib/api";
import { appendSavedViewFilterParams } from "@/lib/savedViewQuery";
import type { SavedViewFilters } from "@/hooks/useSavedViews";
import { usePagedList } from "@/hooks/usePagedList";

export type ContractParty = {
  id: number;
  contract_id: number;
  name: string;
  email: string | null;
  role: string;
  created_at: string;
};

export type ContractSigner = {
  id: number;
  contract_id: number;
  party_id: number | null;
  name: string;
  email: string;
  signing_order: number;
  status: string;
  signed_at: string | null;
  created_at: string;
};

export type ContractEvent = {
  id: number;
  contract_id: number;
  event_type: string;
  payload_json: Record<string, unknown>;
  created_by_id: number | null;
  created_at: string;
};

export type Contract = {
  id: number;
  tenant_id?: number;
  contract_number: string;
  title: string;
  status: string;
  organization_id: number | null;
  contact_id: number | null;
  opportunity_id: number | null;
  quote_id: number | null;
  order_id: number | null;
  document_id: number | null;
  effective_date: string | null;
  expiration_date: string | null;
  renewal_date: string | null;
  value_amount: string | number | null;
  currency: string | null;
  owner_id: number | null;
  created_by_id?: number | null;
  created_at: string;
  updated_at: string;
  parties?: ContractParty[];
  signers?: ContractSigner[];
  events?: ContractEvent[];
};

export type ContractsResponse = {
  results: Contract[];
  range_start: number;
  range_end: number;
  total_count: number;
  total_pages: number;
  page: number;
};

async function fetchContracts(page: number, pageSize: number, _visibleColumns: string[], filters: SavedViewFilters): Promise<ContractsResponse> {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  appendSavedViewFilterParams(params, filters);
  const searchTerm = typeof filters.search === "string" ? filters.search.trim() : "";
  const path = searchTerm ? `/contracts/search?query=${encodeURIComponent(searchTerm)}&${params.toString()}` : `/contracts?${params.toString()}`;
  const res = await apiFetch(path);
  if (!res.ok) throw new Error(`Failed with ${res.status}`);
  return res.json();
}

export function useContracts(visibleColumns: string[], viewFilters: SavedViewFilters, initialPage = 1, initialPageSize = 10) {
  const paged = usePagedList<Contract, ContractsResponse>({
    queryKey: ["contracts"],
    fetcher: (page, pageSize, filters, columns) => fetchContracts(page, pageSize, columns, filters),
    visibleColumns,
    filters: viewFilters,
    initialPage,
    initialPageSize,
    errorMessage: () => "Failed to load contracts",
  });

  return {
    contracts: paged.items,
    page: paged.page,
    totalPages: paged.totalPages,
    totalCount: paged.totalCount,
    rangeStart: paged.rangeStart,
    rangeEnd: paged.rangeEnd,
    pageSize: paged.pageSize,
    isLoading: paged.isLoading,
    isFetching: paged.isFetching,
    error: paged.error,
    goToPage: paged.goToPage,
    onPageSizeChange: paged.onPageSizeChange,
    refresh: paged.refresh,
  };
}
