"use client";

import { apiFetch } from "@/lib/api";
import { appendSavedViewFilterParams } from "@/lib/savedViewQuery";
import type { SavedViewFilters } from "@/hooks/useSavedViews";
import { usePagedList } from "@/hooks/usePagedList";
import type { __Module__, __Module__CreateRequest, __Module__ListResponse, __Module__UpdateRequest } from "@/types/__modules__";

async function parseJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? `Request failed with ${res.status}`);
  return body as T;
}

async function fetch__Modules__(
  page: number,
  pageSize: number,
  visibleColumns: string[],
  filters: SavedViewFilters,
): Promise<__Module__ListResponse> {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  const baseVisibleColumns = visibleColumns.filter((column) => !column.startsWith("custom:"));
  if (baseVisibleColumns.length) params.append("fields", baseVisibleColumns.join(","));
  appendSavedViewFilterParams(params, filters);
  const searchTerm = typeof filters.search === "string" ? filters.search.trim() : "";
  const path = searchTerm ? "__api_prefix__/search?" + params.toString() : "__api_prefix__?" + params.toString();
  return parseJson<__Module__ListResponse>(await apiFetch(path));
}

export function use__Modules__(
  visibleColumns: string[],
  viewFilters: SavedViewFilters,
  initialPage = 1,
  initialPageSize = 10,
) {
  const paged = usePagedList<__Module__, __Module__ListResponse>({
    queryKey: ["__MODULE_KEY__"],
    fetcher: (page, pageSize, filters, columns) => fetch__Modules__(page, pageSize, columns, filters),
    visibleColumns,
    filters: viewFilters,
    initialPage,
    initialPageSize,
    errorMessage: () => "Failed to load __display_name__",
  });

  return {
    __modules__: paged.items,
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

export async function get__Module__(id: string | number) {
  return parseJson<__Module__>(await apiFetch(`__api_prefix__/${id}`));
}

export async function create__Module__(payload: __Module__CreateRequest) {
  return parseJson<__Module__>(await apiFetch("__api_prefix__", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }));
}

export async function update__Module__(id: string | number, payload: __Module__UpdateRequest) {
  return parseJson<__Module__>(await apiFetch(`__api_prefix__/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }));
}

export async function delete__Module__(id: string | number) {
  const res = await apiFetch(`__api_prefix__/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Request failed with ${res.status}`);
  }
}
