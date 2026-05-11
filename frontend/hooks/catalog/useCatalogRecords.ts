"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import { usePagedList } from "@/hooks/usePagedList";
import type { SavedViewFilters } from "@/hooks/useSavedViews";

export type CatalogKind = "products" | "services";

export type CatalogRecord = {
  id: number;
  name: string;
  description?: string | null;
  sku?: string | null;
  currency: string;
  public_unit_price: number | string;
  stock_status?: "untracked" | "in_stock" | "out_of_stock" | "preorder";
  stock_quantity?: number | string | null;
  is_active: boolean;
  media_url?: string | null;
  media_content_type?: string | null;
  media_original_filename?: string | null;
  created_at: string;
  updated_at: string;
};

export type CatalogRecordPayload = {
  name: string;
  description?: string | null;
  sku?: string | null;
  currency: string;
  public_unit_price: number;
  stock_status?: string;
  stock_quantity?: number | null;
  is_active: boolean;
};

type CatalogRecordsResponse = {
  results: CatalogRecord[];
  range_start: number;
  range_end: number;
  total_count: number;
  total_pages: number;
  page: number;
  page_size: number;
};

const DEFAULT_ERROR = "Something went wrong while loading catalog records";

function toApiErrorMessage(body: unknown, fallback: string) {
  if (body && typeof body === "object") {
    const detail = "detail" in body ? body.detail : undefined;
    const message = "message" in body ? body.message : undefined;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return DEFAULT_ERROR;
}

function pathFor(kind: CatalogKind, suffix = "") {
  return `/catalog/${kind}${suffix}`;
}

async function parseJsonResponse<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(toApiErrorMessage(body, fallback));
  }
  return res.json();
}

async function fetchCatalogRecords(
  kind: CatalogKind,
  page: number,
  pageSize: number,
  filters: SavedViewFilters,
): Promise<CatalogRecordsResponse> {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
    include_inactive: "true",
  });

  const search = typeof filters.search === "string" ? filters.search.trim() : "";
  if (search) {
    params.set("search", search);
  }

  const res = await apiFetch(`${pathFor(kind)}?${params.toString()}`);
  return parseJsonResponse<CatalogRecordsResponse>(res, `Failed with ${res.status}`);
}

async function fetchCatalogRecord(kind: CatalogKind, id: number): Promise<CatalogRecord> {
  const res = await apiFetch(pathFor(kind, `/${id}`));
  return parseJsonResponse<CatalogRecord>(res, `Failed with ${res.status}`);
}

async function createCatalogRecord(kind: CatalogKind, payload: CatalogRecordPayload): Promise<CatalogRecord> {
  const res = await apiFetch(pathFor(kind), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse<CatalogRecord>(res, `Failed with ${res.status}`);
}

async function updateCatalogRecord(kind: CatalogKind, id: number, payload: CatalogRecordPayload): Promise<CatalogRecord> {
  const res = await apiFetch(pathFor(kind, `/${id}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse<CatalogRecord>(res, `Failed with ${res.status}`);
}

async function uploadCatalogRecordMedia(kind: CatalogKind, id: number, file: File): Promise<CatalogRecord> {
  const form = new FormData();
  form.append("file", file);

  const res = await apiFetch(pathFor(kind, `/${id}/media`), {
    method: "PUT",
    body: form,
  });
  return parseJsonResponse<CatalogRecord>(res, `Failed with ${res.status}`);
}

async function deleteCatalogRecord(kind: CatalogKind, id: number): Promise<CatalogRecord> {
  const res = await apiFetch(pathFor(kind, `/${id}`), {
    method: "DELETE",
  });
  return parseJsonResponse<CatalogRecord>(res, `Failed with ${res.status}`);
}

export function useCatalogRecords(
  kind: CatalogKind,
  visibleColumns: string[],
  filters: SavedViewFilters,
  initialPage = 1,
  initialPageSize = 10,
) {
  const queryClient = useQueryClient();
  const queryKey = ["catalog", kind];
  const paged = usePagedList<CatalogRecord, CatalogRecordsResponse>({
    queryKey,
    fetcher: (page, pageSize, viewFilters) => fetchCatalogRecords(kind, page, pageSize, viewFilters),
    visibleColumns,
    filters,
    initialPage,
    initialPageSize,
    refetchOnWindowFocus: false,
    errorMessage: getErrorMessage,
  });

  const createMutation = useMutation({
    mutationFn: (payload: CatalogRecordPayload) => createCatalogRecord(kind, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: CatalogRecordPayload }) => updateCatalogRecord(kind, id, payload),
    onSuccess: async (_record, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: [...queryKey, variables.id] }),
      ]);
    },
  });

  const uploadMutation = useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) => uploadCatalogRecordMedia(kind, id, file),
    onSuccess: async (_record, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: [...queryKey, variables.id] }),
      ]);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteCatalogRecord(kind, id),
    onSuccess: async (_record, id) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: [...queryKey, id] }),
      ]);
    },
  });

  return {
    records: paged.items,
    page: paged.page,
    pageSize: paged.pageSize,
    totalPages: paged.totalPages,
    totalCount: paged.totalCount,
    rangeStart: paged.rangeStart,
    rangeEnd: paged.rangeEnd,
    isLoading: paged.isLoading,
    isFetching: paged.isFetching,
    error: paged.error,
    goToPage: paged.goToPage,
    onPageSizeChange: paged.onPageSizeChange,
    refresh: paged.refresh,
    createRecord: (payload: CatalogRecordPayload) => createMutation.mutateAsync(payload),
    updateRecord: (id: number, payload: CatalogRecordPayload) => updateMutation.mutateAsync({ id, payload }),
    uploadMedia: (id: number, file: File) => uploadMutation.mutateAsync({ id, file }),
    deleteRecord: (id: number) => deleteMutation.mutateAsync(id),
    isSaving: createMutation.isPending || updateMutation.isPending || uploadMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}

export function useCatalogRecordActions(kind: CatalogKind) {
  const queryClient = useQueryClient();
  const queryKey = ["catalog", kind];

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: CatalogRecordPayload }) => updateCatalogRecord(kind, id, payload),
    onSuccess: async (_record, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: [...queryKey, variables.id] }),
      ]);
    },
  });

  const uploadMutation = useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) => uploadCatalogRecordMedia(kind, id, file),
    onSuccess: async (_record, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: [...queryKey, variables.id] }),
      ]);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteCatalogRecord(kind, id),
    onSuccess: async (_record, id) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: [...queryKey, id] }),
      ]);
    },
  });

  return {
    updateRecord: (id: number, payload: CatalogRecordPayload) => updateMutation.mutateAsync({ id, payload }),
    uploadMedia: (id: number, file: File) => uploadMutation.mutateAsync({ id, file }),
    deleteRecord: (id: number) => deleteMutation.mutateAsync(id),
    isSaving: updateMutation.isPending || uploadMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}

export function useCatalogRecord(kind: CatalogKind, id: number | null) {
  return useQuery({
    queryKey: ["catalog", kind, id],
    queryFn: () => fetchCatalogRecord(kind, id as number),
    enabled: id != null,
    refetchOnWindowFocus: false,
  });
}
