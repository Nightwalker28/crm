"use client";

import { useCallback, useDeferredValue, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type { SavedViewFilters } from "@/hooks/useSavedViews";

export type PagedListResponse<T> = {
  results: T[];
  range_start: number;
  range_end: number;
  total_count: number;
  total_pages: number;
  page: number;
};

type UsePagedListOptions<T, Response extends PagedListResponse<T>> = {
  queryKey: readonly unknown[];
  fetcher: (page: number, pageSize: number, filters: SavedViewFilters, visibleColumns: string[]) => Promise<Response>;
  visibleColumns: string[];
  filters: SavedViewFilters;
  initialPage?: number;
  initialPageSize?: number;
  refetchOnWindowFocus?: boolean;
  errorMessage?: (error: unknown) => string | null;
};

export function usePagedList<T, Response extends PagedListResponse<T>>({
  queryKey,
  fetcher,
  visibleColumns,
  filters,
  initialPage = 1,
  initialPageSize = 10,
  refetchOnWindowFocus,
  errorMessage,
}: UsePagedListOptions<T, Response>) {
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const deferredFilters = useDeferredValue(filters);

  const query = useQuery<Response>({
    queryKey: [...queryKey, page, pageSize, deferredFilters, visibleColumns],
    queryFn: () => fetcher(page, pageSize, deferredFilters, visibleColumns),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus,
  });

  const data = query.data;
  const { refetch } = query;
  const goToPage = useCallback((nextPage: number) => setPage(Math.max(1, nextPage)), []);
  const onPageSizeChange = useCallback((nextPageSize: number) => {
    setPage(1);
    setPageSize(Math.max(1, nextPageSize));
  }, []);
  const refresh = useCallback(() => refetch(), [refetch]);

  return {
    data,
    items: data?.results ?? [],
    page: data?.page ?? page,
    pageSize,
    totalPages: data?.total_pages ?? 1,
    totalCount: data?.total_count ?? 0,
    rangeStart: data?.range_start ?? 0,
    rangeEnd: data?.range_end ?? 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error ? (errorMessage ? errorMessage(query.error) : query.error instanceof Error ? query.error.message : "Failed to load records") : null,
    goToPage,
    onPageSizeChange,
    refresh,
    query,
  };
}
