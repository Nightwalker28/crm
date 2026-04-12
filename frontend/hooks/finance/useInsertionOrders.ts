"use client";

import { useDeferredValue, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";

export type InsertionOrder = {
  file_name?: string;
  campaign_name: string;
  user_id?: number;
  user_name: string;
  photo_url: string | null;
  updated_at: string;
};

export type InsertionOrdersResponse = {
  results: InsertionOrder[];
  range_start: number;
  range_end: number;
  total_count: number;
  total_pages?: number;
  page?: number;
};

const DEFAULT_ERROR = "Something went wrong while loading IOs";

async function fetchInsertionOrders(page: number, pageSize: number): Promise<InsertionOrdersResponse> {
  const res = await apiFetch(`/finance/insertion-orders/all?page=${page}&page_size=${pageSize}`);
  if (!res.ok) throw new Error(`Failed with ${res.status}`);
  return res.json();
}

async function searchInsertionOrders(field: string, value: string): Promise<InsertionOrdersResponse> {
  const res = await apiFetch(
    `/finance/insertion-orders/search?field=${encodeURIComponent(field)}&value=${encodeURIComponent(value)}`,
  );
  if (!res.ok) throw new Error(`Failed with ${res.status}`);
  return res.json();
}

function getErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? DEFAULT_ERROR : DEFAULT_ERROR;
}

export function useInsertionOrders(initialPage = 1, initialPageSize = 10) {
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchField, setSearchField] = useState("campaign_name");

  const deferredSearchTerm = useDeferredValue(searchTerm.trim());
  const showingSearch = deferredSearchTerm.length > 0;

  const pageQuery = useQuery<InsertionOrdersResponse>({
    queryKey: ["insertion-orders", page, pageSize],
    queryFn: () => fetchInsertionOrders(page, pageSize),
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
  });

  const searchQuery = useQuery<InsertionOrdersResponse>({
    queryKey: ["insertion-orders-search", searchField, deferredSearchTerm],
    queryFn: () => searchInsertionOrders(searchField, deferredSearchTerm),
    enabled: showingSearch,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
  });

  const activeQuery = showingSearch ? searchQuery : pageQuery;
  const activeData = activeQuery.data;

  return {
    orders: activeData?.results ?? [],
    page,
    pageSize,
    totalPages: pageQuery.data?.total_pages ?? Math.max(1, Math.ceil((pageQuery.data?.total_count ?? 0) / pageSize)),
    totalCount: pageQuery.data?.total_count ?? 0,
    rangeStart: pageQuery.data?.range_start ?? 0,
    rangeEnd: pageQuery.data?.range_end ?? 0,
    isLoading: activeQuery.isLoading || activeQuery.isFetching,
    error: activeQuery.error ? getErrorMessage(activeQuery.error) : null,
    searchTerm,
    searchField,
    showingSearch,
    goToPage: (nextPage: number) => setPage(Math.max(1, nextPage)),
    onPageSizeChange: (size: number) => {
      setPage(1);
      setPageSize(Math.max(1, size));
    },
    refresh: () => {
      if (showingSearch) {
        return searchQuery.refetch();
      }
      return pageQuery.refetch();
    },
    setSearchTerm,
    setSearchField,
  };
}
