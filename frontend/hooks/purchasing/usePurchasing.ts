"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, apiFetch } from "@/lib/api";

export type PurchaseOrderStatus = "draft" | "ordered" | "received" | "closed" | "cancelled";

export type PurchaseOrderLine = {
  id: number; product_id: number; product_name: string; sku: string | null; vendor_sku: string | null; description: string | null;
  quantity: string; unit_cost: string; line_total: string; received: string; to_receive: string;
};

export type PurchaseOrder = {
  id: number; number: string; status: PurchaseOrderStatus; receipt_status: "none" | "partial" | "received";
  vendor_id: number; vendor_name: string | null; vendor_email?: string | null; vendor_address?: string | null;
  warehouse_id: number; warehouse_name: string | null; currency: string;
  expected_date: string | null; vendor_reference: string | null; notes: string | null; subtotal: string;
  ordered_at: string | null; closed_at: string | null; close_reason: string | null; cancel_reason: string | null;
  created_at: string; updated_at: string; is_deleted: boolean; line_count: number; total_quantity: string;
  lines?: PurchaseOrderLine[];
  receipts?: Array<{ id: number; number: string; status: string; received_on: string | null; vendor_delivery_ref: string | null; total_quantity: string }>;
};

export type PurchaseOrderDraft = {
  vendor_id: number; warehouse_id?: number | null; currency?: string | null; expected_date: string | null; vendor_reference: string | null; notes: string | null;
  lines: Array<{ product_id: number; description: string | null; quantity: string; unit_cost: string }>;
};

export type ReceiptLine = {
  id: number; order_line_id: number; product_id: number; product_name: string; sku: string | null;
  quantity: string; ordered: string | null; unit_cost: string | null; to_receive: string | null;
};

export type PurchaseReceipt = {
  id: number; number: string; status: "draft" | "posted" | "cancelled"; order_id: number; order_number: string | null;
  vendor_id: number | null; vendor_name: string | null; warehouse_id: number; warehouse_name: string | null;
  received_on: string | null; vendor_delivery_ref: string | null; notes: string | null; posted_at: string | null; cancel_reason: string | null;
  created_at: string; is_deleted: boolean; line_count: number; total_quantity: string; lines?: ReceiptLine[];
};

export type ReceiptDraft = {
  received_on: string | null; vendor_delivery_ref: string | null; notes: string | null;
  lines: Array<{ order_line_id: number; quantity: string }>;
};

export type ReorderSuggestion = {
  product_id: number; product_name: string; sku: string | null; vendor_sku: string | null; warehouse_id: number; warehouse_name: string;
  on_hand: string; available: string; backordered: string; incoming: string; projected: string;
  reorder_point: string; reorder_quantity: string; suggested: string;
  preferred_vendor_id: number | null; preferred_vendor_name: string | null; unit_cost: string | null; currency: string; lead_time_days: number | null;
};

type Page<T> = { results: T[]; page: number; page_size: number; total_count: number; total_pages: number; range_start: number; range_end: number };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(`/purchasing${path}`, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
    throw new ApiError(response.status, typeof body?.detail === "string" ? body.detail : "Purchasing could not be loaded.");
  }
  return response.status === 204 ? (null as T) : (response.json() as Promise<T>);
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function usePurchaseOrders(page: number, pageSize: number, status: string, search: string) {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (status) params.set("status", status);
  if (search.trim()) params.set("search", search.trim());
  return useQuery({ queryKey: ["purchasing", "orders", page, pageSize, status, search], queryFn: () => request<Page<PurchaseOrder>>(`/orders?${params}`), placeholderData: keepPreviousData });
}

export function usePurchaseOrder(id: number | null) {
  return useQuery({ queryKey: ["purchasing", "orders", "record", id], queryFn: () => request<PurchaseOrder>(`/orders/${id}`), enabled: id !== null });
}

export function usePurchaseReceipts(page: number, pageSize: number, status: string, search: string) {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (status) params.set("status", status);
  if (search.trim()) params.set("search", search.trim());
  return useQuery({ queryKey: ["purchasing", "receipts", page, pageSize, status, search], queryFn: () => request<Page<PurchaseReceipt>>(`/receipts?${params}`), placeholderData: keepPreviousData });
}

export function usePurchaseReceipt(id: number | null) {
  return useQuery({ queryKey: ["purchasing", "receipts", "record", id], queryFn: () => request<PurchaseReceipt>(`/receipts/${id}`), enabled: id !== null });
}

export function useReorderSuggestions(warehouseId: number | null) {
  return useQuery({
    queryKey: ["purchasing", "reorder", warehouseId],
    queryFn: async () => (await request<{ results: ReorderSuggestion[] }>(`/reorder${warehouseId ? `?warehouse_id=${warehouseId}` : ""}`)).results,
  });
}

export function usePurchasingActions() {
  const client = useQueryClient();
  const invalidate = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["purchasing"] }),
      client.invalidateQueries({ queryKey: ["inventory"] }),
      client.invalidateQueries({ queryKey: ["sales-order-fulfilment"] }),
    ]);
  };
  const createOrder = useMutation({ mutationFn: (payload: PurchaseOrderDraft) => request<PurchaseOrder>("/orders", json("POST", payload)), onSuccess: invalidate });
  const updateOrder = useMutation({ mutationFn: ({ id, payload }: { id: number; payload: PurchaseOrderDraft }) => request<PurchaseOrder>(`/orders/${id}`, json("PATCH", payload)), onSuccess: invalidate });
  const placeOrder = useMutation({ mutationFn: (id: number) => request<PurchaseOrder>(`/orders/${id}/order`, { method: "POST" }), onSuccess: invalidate });
  const closeOrder = useMutation({ mutationFn: ({ id, reason }: { id: number; reason: string }) => request<PurchaseOrder>(`/orders/${id}/close`, json("POST", { reason })), onSuccess: invalidate });
  const cancelOrder = useMutation({ mutationFn: ({ id, reason }: { id: number; reason: string }) => request<PurchaseOrder>(`/orders/${id}/cancel`, json("POST", { reason })), onSuccess: invalidate });
  const removeOrder = useMutation({ mutationFn: (id: number) => request<void>(`/orders/${id}`, { method: "DELETE" }), onSuccess: invalidate });
  const createReceipt = useMutation({ mutationFn: (payload: ReceiptDraft & { order_id: number }) => request<PurchaseReceipt>("/receipts", json("POST", payload)), onSuccess: invalidate });
  const updateReceipt = useMutation({ mutationFn: ({ id, payload }: { id: number; payload: ReceiptDraft }) => request<PurchaseReceipt>(`/receipts/${id}`, json("PATCH", payload)), onSuccess: invalidate });
  const postReceipt = useMutation({ mutationFn: (id: number) => request<PurchaseReceipt>(`/receipts/${id}/post`, { method: "POST" }), onSuccess: invalidate });
  const cancelReceipt = useMutation({ mutationFn: ({ id, reason }: { id: number; reason: string }) => request<PurchaseReceipt>(`/receipts/${id}/cancel`, json("POST", { reason })), onSuccess: invalidate });
  const removeReceipt = useMutation({ mutationFn: (id: number) => request<void>(`/receipts/${id}`, { method: "DELETE" }), onSuccess: invalidate });
  const draftFromReorder = useMutation({
    mutationFn: (rows: Array<{ product_id: number; warehouse_id: number; quantity: string }>) => request<{ results: PurchaseOrder[] }>("/reorder/orders", json("POST", { rows })),
    onSuccess: invalidate,
  });
  const all = [createOrder, updateOrder, placeOrder, closeOrder, cancelOrder, removeOrder, createReceipt, updateReceipt, postReceipt, cancelReceipt, removeReceipt, draftFromReorder];
  return {
    createOrder: createOrder.mutateAsync, updateOrder: updateOrder.mutateAsync, placeOrder: placeOrder.mutateAsync,
    closeOrder: closeOrder.mutateAsync, cancelOrder: cancelOrder.mutateAsync, removeOrder: removeOrder.mutateAsync,
    createReceipt: createReceipt.mutateAsync, updateReceipt: updateReceipt.mutateAsync, postReceipt: postReceipt.mutateAsync,
    cancelReceipt: cancelReceipt.mutateAsync, removeReceipt: removeReceipt.mutateAsync, draftFromReorder: draftFromReorder.mutateAsync,
    isSaving: all.some((item) => item.isPending),
  };
}
