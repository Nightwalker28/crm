"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, apiFetch } from "@/lib/api";

/** One level of nesting: `full_name` is "Parent / Child" for a subcategory. */
export type CatalogCategory = {
  id: number;
  name: string;
  full_name: string;
  parent_id: number | null;
  description: string | null;
  sort_order: number;
  product_count: number;
  service_count: number;
  created_at: string;
  updated_at: string;
};

export type CatalogCategoryPayload = {
  name: string;
  parent_id: number | null;
  description: string | null;
  sort_order: number;
};

const QUERY_KEY = ["catalog", "categories"];

/**
 * The category service writes its refusals for people ("3 catalog items use this category…"),
 * so a 4xx carries the backend's sentence; anything else falls back to `fallback`.
 */
async function requestCategory(path: string, init: RequestInit, fallback: string) {
  const res = await apiFetch(path, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: unknown } | null;
    const detail = res.status < 500 && typeof body?.detail === "string" ? body.detail : fallback;
    throw new ApiError(res.status, detail);
  }
  return res.status === 204 ? null : res.json();
}

export function useCatalogCategories(enabled = true) {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<CatalogCategory[]> => {
      const body = await requestCategory("/catalog/categories", {}, "Categories could not be loaded.");
      return Array.isArray(body?.results) ? body.results : [];
    },
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useCatalogCategoryActions() {
  const queryClient = useQueryClient();
  const invalidate = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    // A rename changes the category shown on every product and service.
    queryClient.invalidateQueries({ queryKey: ["catalog", "products"] }),
    queryClient.invalidateQueries({ queryKey: ["catalog", "services"] }),
  ]);
  const json = (method: string, payload: CatalogCategoryPayload): RequestInit => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const create = useMutation({
    mutationFn: (payload: CatalogCategoryPayload) => requestCategory("/catalog/categories", json("POST", payload), "The category could not be created."),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: CatalogCategoryPayload }) =>
      requestCategory(`/catalog/categories/${id}`, json("PUT", payload), "The category could not be saved."),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: number) => requestCategory(`/catalog/categories/${id}`, { method: "DELETE" }, "The category could not be deleted."),
    onSuccess: invalidate,
  });

  return {
    createCategory: create.mutateAsync,
    updateCategory: update.mutateAsync,
    deleteCategory: remove.mutateAsync,
    isSaving: create.isPending || update.isPending,
    isDeleting: remove.isPending,
  };
}
