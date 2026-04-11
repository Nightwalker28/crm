"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

export type InsertionOrder = {
  file_name: string;
  campaign_name: string;
  user_id: number;
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

export function useInsertionOrders(initialPage = 1, initialPageSize = 10) {
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const [orders, setOrders] = useState<InsertionOrder[]>([]);
  const [totalPages, setTotalPages] = useState(1);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchField, setSearchField] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState<string | null>(null);

  const [totalCount, setTotalCount] = useState(0);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(0);

  const fetchPage = useCallback(
    async (targetPage: number, targetPageSize = pageSize) => {
      const safePage = Math.max(1, targetPage);
      const safePageSize = Math.max(1, targetPageSize);

      try {
        setIsLoading(true);
        setError(null);

        const url =
          searchField && searchValue
            ? `/finance/insertion-orders/search?field=${encodeURIComponent(
                searchField
              )}&value=${encodeURIComponent(searchValue)}&page=${safePage}&page_size=${safePageSize}`
            : `/finance/insertion-orders/all?page=${safePage}&page_size=${safePageSize}`;

        const res = await apiFetch(url);

        if (!res.ok) throw new Error(`Failed with ${res.status}`);

        const json: InsertionOrdersResponse = await res.json();

        setOrders(json.results ?? []);
        setTotalCount(json.total_count ?? 0);
        setRangeStart(json.range_start ?? 0);
        setRangeEnd(json.range_end ?? 0);

        const computedTotalPages = Math.max(
          1,
          Math.ceil((json.total_count ?? 0) / safePageSize)
        );
        setTotalPages(json.total_pages ?? computedTotalPages);

        setPage(json.page ?? safePage);

        setPageSize(safePageSize);
      } catch (err) {
        console.error(err);
        setError("Something went wrong while loading IOs");
      } finally {
        setIsLoading(false);
      }
    },
    [searchField, searchValue, pageSize]
  );

  useEffect(() => {
    fetchPage(initialPage, pageSize);
  }, [fetchPage, initialPage, pageSize]);

  const goToPage = (p: number) => fetchPage(p, pageSize);

  const onPageSizeChange = (size: number) => {
    fetchPage(1, size);
  };

  return {
    page,
    pageSize,
    totalPages,
    orders,
    isLoading,
    error,
    totalCount,
    rangeStart,
    rangeEnd,
    goToPage,
    onPageSizeChange,
    refresh: () => fetchPage(page, pageSize),

    setSearch: (field: string, value: string) => {
      setSearchField(field);
      setSearchValue(value);
      fetchPage(1, pageSize);
    },
  };
}
