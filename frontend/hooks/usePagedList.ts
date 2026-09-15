"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { usePageAddress } from "@/hooks/usePageAddress";
import type { SavedViewFilters } from "@/hooks/useSavedViews";
import { canonicalSavedViewFiltersKey, LIST_ADDRESS_KEYS } from "@/lib/savedViewQuery";

export type PagedListSort = { key: string; direction: "asc" | "desc" } | null;

export type PagedListResponse<T> = {
  results: T[];
  range_start: number;
  range_end: number;
  total_count: number;
  total_pages: number;
  page: number;
};

/**
 * A5 — the list searched on every keystroke.
 *
 * There was no debounce in `usePagedList`, `useSavedViews` or `SearchBar`, so all 14
 * toolbar pages fired a request per character. It is answered here rather than in
 * `SearchBar` because the input must stay instant: the operator types into `draftConfig`
 * and sees every character immediately, and what waits is the *query*. A control that
 * debounced its own value would make the field itself feel behind the typing.
 *
 * Only a search change waits. A filter chip or a dropdown is a deliberate single action
 * and applies at once — delaying it would read as lag, not as batching.
 */
const SEARCH_DEBOUNCE_MS = 300;

type UsePagedListOptions<T, Response extends PagedListResponse<T>> = {
  queryKey: readonly unknown[];
  fetcher: (page: number, pageSize: number, filters: SavedViewFilters, visibleColumns: string[], sort: PagedListSort) => Promise<Response>;
  visibleColumns: string[];
  visibleColumnsAffectQuery?: boolean;
  filters: SavedViewFilters;
  sort?: PagedListSort;
  initialPage?: number;
  initialPageSize?: number;
  /**
   * A1 — page and page size live in the address. Pass `false` for a list that is not the
   * route's subject: two paged lists on one page would write the same two params.
   */
  address?: boolean;
  refetchOnWindowFocus?: boolean;
  staleTime?: number;
  errorMessage?: (error: unknown) => string | null;
  fallbackErrorMessage?: string;
};

export function usePagedList<T, Response extends PagedListResponse<T>>({
  queryKey,
  fetcher,
  visibleColumns,
  visibleColumnsAffectQuery = false,
  filters,
  sort = null,
  initialPage = 1,
  initialPageSize = 10,
  address = true,
  refetchOnWindowFocus,
  staleTime,
  errorMessage,
  fallbackErrorMessage = "Failed to load records",
}: UsePagedListOptions<T, Response>) {
  const { params, updateAddress } = usePageAddress(address);

  // Only the search *string* is held back. Everything else in `filters` is passed through
  // as it arrives, so a chip or a dropdown still applies on the click that set it.
  const search = typeof filters.search === "string" ? filters.search : "";
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    if (search === debouncedSearch) return;
    const timer = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [debouncedSearch, search]);
  const appliedFilters = useMemo(() => ({ ...filters, search: debouncedSearch }), [debouncedSearch, filters]);

  const [pageSize, setPageSize] = useState(() => {
    const fromAddress = address ? Number(params.get(LIST_ADDRESS_KEYS.pageSize)) : NaN;
    return Number.isFinite(fromAddress) && fromAddress > 0 ? fromAddress : initialPageSize;
  });
  const filtersKey = useMemo(() => canonicalSavedViewFiltersKey(appliedFilters), [appliedFilters]);
  const sortKey = useMemo(() => JSON.stringify(sort), [sort]);
  const [pageState, setPageState] = useState(() => {
    const fromAddress = address ? Number(params.get(LIST_ADDRESS_KEYS.page)) : NaN;
    const startPage = Number.isFinite(fromAddress) && fromAddress > 0 ? fromAddress : initialPage;
    return { page: startPage, filtersKey, sortKey };
  });
  const page = pageState.filtersKey === filtersKey && pageState.sortKey === sortKey ? pageState.page : 1;
  const visibleColumnsKey = useMemo(() => [...visibleColumns].sort().join(","), [visibleColumns]);
  const projectionKey = visibleColumnsAffectQuery ? visibleColumnsKey : "";

  // Page 1 at the default size is what an address with neither param means, so writing
  // them would put noise in every shared link. Only divergence is written.
  const addressPage = page > 1 ? String(page) : "";
  const addressPageSize = pageSize !== initialPageSize ? String(pageSize) : "";
  const lastWritten = useRef<string | null>(null);
  useEffect(() => {
    if (!address) return;
    const signature = `${addressPage}|${addressPageSize}`;
    if (lastWritten.current === signature) return;
    // The first pass adopts what the address already said instead of writing. A list must
    // not rewrite its own URL on mount: the state was just read *from* the address, and a
    // write in the same pass would replace a shared link's state with the defaults.
    const isFirstPass = lastWritten.current === null;
    lastWritten.current = signature;
    if (isFirstPass) return;
    updateAddress((next) => {
      if (addressPage) next.set(LIST_ADDRESS_KEYS.page, addressPage);
      else next.delete(LIST_ADDRESS_KEYS.page);
      if (addressPageSize) next.set(LIST_ADDRESS_KEYS.pageSize, addressPageSize);
      else next.delete(LIST_ADDRESS_KEYS.pageSize);
    });
  }, [address, addressPage, addressPageSize, updateAddress]);

  const query = useQuery<Response>({
    queryKey: [...queryKey, page, pageSize, filtersKey, projectionKey, sortKey],
    queryFn: () => fetcher(page, pageSize, appliedFilters, visibleColumns, sort),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus,
    staleTime,
  });

  const data = query.data;
  const { refetch } = query;
  const goToPage = useCallback(
    (nextPage: number) => setPageState({ page: Math.max(1, nextPage), filtersKey, sortKey }),
    [filtersKey, sortKey],
  );
  const onPageSizeChange = useCallback((nextPageSize: number) => {
    setPageState({ page: 1, filtersKey, sortKey });
    setPageSize(Math.max(1, nextPageSize));
  }, [filtersKey, sortKey]);
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
    /**
     * Includes the debounce window. Without it a list looks frozen for 300ms after every
     * keystroke — nothing is in flight yet, so the shell's "Refreshing" marker is off
     * while the operator can plainly see the rows do not match what they typed. Callers
     * that need the strict react-query flag still have it on the returned `query`.
     */
    isFetching: query.isFetching || search !== debouncedSearch,
    /** True while a typed search is still inside the debounce window. */
    isSearchPending: search !== debouncedSearch,
    error: query.error ? (errorMessage ? errorMessage(query.error) : query.error instanceof Error ? query.error.message : fallbackErrorMessage) : null,
    goToPage,
    onPageSizeChange,
    refresh,
    query,
  };
}
