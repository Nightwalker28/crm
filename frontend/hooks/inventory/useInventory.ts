"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, apiFetch } from "@/lib/api";

export type Warehouse = { id: number; code: string; name: string; address: string | null; is_default: boolean; is_active: boolean; is_deleted: boolean };
export type StockRow = { product_id: number; product_name: string; sku: string | null; category_name: string | null; warehouse_id: number; warehouse_name: string; on_hand: string; reserved: string; available: string; reorder_point: string; reorder_quantity: string; stock_status: string };
export type StockMove = { id: number; product_id: number; product_name: string; warehouse_id: number; warehouse_name: string; quantity: string; on_hand_after: string; move_type: string; source_type: string; source_id: number; reason: string | null; note: string | null; created_by: number | null; actor_label: string; occurred_at: string };
export type ProductStock = { product_id: number; track_inventory: boolean; on_hand: string | null; available: string | null; warehouses: Array<{ id: number; name: string; code: string; on_hand: string; reserved: string; available: string }>; movements: StockMove[] };
export type InventoryKind = "adjustments" | "transfers";
export type InventoryDocumentLine = { id: number; product_id: number; product_name: string; sku: string | null; expected?: string; counted?: string | null; delta?: string | null; quantity?: string };
export type InventoryDocument = {
  id: number; number: string; status: "draft" | "posted" | "cancelled"; notes: string | null;
  posted_at: string | null; posted_by: number | null; created_at: string; is_deleted: boolean;
  line_count: number; lines?: InventoryDocumentLine[];
  warehouse_id?: number; warehouse_name?: string; mode?: "quantity" | "count"; reason?: string;
  from_warehouse_id?: number; to_warehouse_id?: number; from_warehouse_name?: string; to_warehouse_name?: string;
};
export type AdjustmentDraft = { warehouse_id: number; mode: "quantity" | "count"; reason: string; notes: string | null; lines: Array<{ product_id: number; counted?: number; delta?: number }> };
export type TransferDraft = { from_warehouse_id: number; to_warehouse_id: number; notes: string | null; lines: Array<{ product_id: number; quantity: number }> };
type Page<T> = { results: T[]; page: number; page_size: number; total_count: number; total_pages: number; range_start: number; range_end: number };
type CursorPage<T> = { results: T[]; next_cursor: string | null; has_more: boolean };

async function inventoryRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(`/inventory${path}`, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
    throw new ApiError(response.status, typeof body?.detail === "string" ? body.detail : "Inventory could not be loaded.");
  }
  return response.status === 204 ? null as T : response.json() as Promise<T>;
}

export function useWarehouses(includeDeleted = false) {
  return useQuery({ queryKey: ["inventory", "warehouses", includeDeleted], queryFn: async () => (await inventoryRequest<{ results: Warehouse[] }>(`/warehouses${includeDeleted ? "?include_deleted=true" : ""}`)).results });
}

export function useStock(page: number, pageSize: number, search: string, warehouseId?: string, levelFilter?: string, filtersAll?: string, filtersAny?: string) {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize), search });
  if (warehouseId) params.set("warehouse_id", warehouseId);
  if (levelFilter) params.set("level_filter", levelFilter);
  if (filtersAll) params.set("filters_all", filtersAll);
  if (filtersAny) params.set("filters_any", filtersAny);
  return useQuery({ queryKey: ["inventory", "stock", page, pageSize, search, warehouseId, levelFilter, filtersAll, filtersAny], queryFn: () => inventoryRequest<Page<StockRow>>(`/stock?${params}`), placeholderData: keepPreviousData });
}

export function useMovements(cursor: string | null, productId?: number, warehouseId?: string, moveType?: string) {
  const params = new URLSearchParams({ limit: "50" });
  if (cursor) params.set("cursor", cursor);
  if (productId) params.set("product_id", String(productId));
  if (warehouseId) params.set("warehouse_id", warehouseId);
  if (moveType) params.set("move_type", moveType);
  return useQuery({ queryKey: ["inventory", "movements", cursor, productId, warehouseId, moveType], queryFn: () => inventoryRequest<CursorPage<StockMove>>(`/movements?${params}`) });
}

export function useProductStock(productId: number | null) {
  return useQuery({ queryKey: ["inventory", "product", productId], queryFn: () => inventoryRequest<ProductStock>(`/products/${productId}/stock`), enabled: productId !== null });
}

export function useInventoryDocuments(kind: InventoryKind, page: number, pageSize: number, status: string) {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (status) params.set("status", status);
  return useQuery({ queryKey: ["inventory", kind, page, pageSize, status], queryFn: () => inventoryRequest<Page<InventoryDocument>>(`/${kind}?${params}`), placeholderData: keepPreviousData });
}

export function useInventoryDocument(kind: InventoryKind, id: number | null) {
  return useQuery({ queryKey: ["inventory", kind, id], queryFn: () => inventoryRequest<InventoryDocument>(`/${kind}/${id}`), enabled: id !== null });
}

export function useInventoryDocumentActions(kind: InventoryKind) {
  const client = useQueryClient();
  const invalidate = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["inventory"] }),
      client.invalidateQueries({ queryKey: ["catalog", "products"] }),
    ]);
  };
  const save = useMutation({ mutationFn: ({ id, payload }: { id?: number; payload: AdjustmentDraft | TransferDraft }) => inventoryRequest<InventoryDocument>(`/${kind}${id ? `/${id}` : ""}`, { method: id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }), onSuccess: invalidate });
  const post = useMutation({ mutationFn: (id: number) => inventoryRequest<InventoryDocument>(`/${kind}/${id}/post`, { method: "POST" }), onSuccess: invalidate });
  const cancel = useMutation({ mutationFn: ({ id, reason }: { id: number; reason: string }) => inventoryRequest<InventoryDocument>(`/${kind}/${id}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) }), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: number) => inventoryRequest<void>(`/${kind}/${id}`, { method: "DELETE" }), onSuccess: invalidate });
  const restore = useMutation({ mutationFn: (id: number) => inventoryRequest<InventoryDocument>(`/${kind}/${id}/restore`, { method: "POST" }), onSuccess: invalidate });
  return { save: save.mutateAsync, post: post.mutateAsync, cancel: cancel.mutateAsync, remove: remove.mutateAsync, restore: restore.mutateAsync,
    isSaving: save.isPending || post.isPending || cancel.isPending || remove.isPending || restore.isPending };
}

export function useInventoryActions() {
  const client = useQueryClient();
  const invalidate = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["inventory"] }),
      client.invalidateQueries({ queryKey: ["catalog", "products"] }),
    ]);
  };
  const adjust = useMutation({ mutationFn: ({ productId, payload }: { productId: number; payload: { warehouse_id?: number; quantity?: number; change?: number; reason: string; note?: string } }) => inventoryRequest<{ id: number; number: string }>(`/products/${productId}/adjust`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }), onSuccess: invalidate });
  const saveWarehouse = useMutation({ mutationFn: ({ id, payload }: { id?: number; payload: { code: string; name: string; address?: string | null; is_active: boolean } }) => inventoryRequest<Warehouse>(`/warehouses${id ? `/${id}` : ""}`, { method: id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }), onSuccess: invalidate });
  const removeWarehouse = useMutation({ mutationFn: (id: number) => inventoryRequest<void>(`/warehouses/${id}`, { method: "DELETE" }), onSuccess: invalidate });
  const restoreWarehouse = useMutation({ mutationFn: (id: number) => inventoryRequest<Warehouse>(`/warehouses/${id}/restore`, { method: "POST" }), onSuccess: invalidate });
  return { adjust: adjust.mutateAsync, saveWarehouse: saveWarehouse.mutateAsync, removeWarehouse: removeWarehouse.mutateAsync, restoreWarehouse: restoreWarehouse.mutateAsync, isSaving: adjust.isPending || saveWarehouse.isPending || removeWarehouse.isPending || restoreWarehouse.isPending };
}
