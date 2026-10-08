"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import { apiErrorFromResponse } from "@/lib/apiErrors";

export type ReturnStatus = "draft" | "received" | "cancelled";

export type ReturnLine = {
  id: number; delivery_line_id: number; order_line_id: number; product_id: number; name: string; sku: string | null;
  quantity: string; restock: boolean; shipped: string | null; returnable: string;
};

export type InventoryReturn = {
  /** The one field system (13b §3.4). */
  custom_fields?: Record<string, unknown> | null;
  id: number; number: string; status: ReturnStatus; reason: string; notes: string | null;
  delivery_id: number; delivery_number: string | null; order_id: number; order_number: string | null; customer_name: string | null;
  warehouse_id: number; warehouse_name: string | null; received_at: string | null; received_by: number | null; cancel_reason: string | null;
  created_at: string; is_deleted: boolean; line_count: number; total_quantity: string; lines?: ReturnLine[];
};

export type ReturnDraft = {
  reason: string; warehouse_id?: number | null; notes: string | null;
  lines: Array<{ delivery_line_id: number; quantity: string; restock: boolean }>;
};


async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) throw await apiErrorFromResponse(response, "Returns could not be loaded.");
  return response.status === 204 ? (null as T) : (response.json() as Promise<T>);
}


export function useReturn(id: number | null) {
  return useQuery({ queryKey: ["inventory", "returns", "record", id], queryFn: () => request<InventoryReturn>(`/inventory/returns/${id}`), enabled: id !== null });
}

export function useReturnActions() {
  const client = useQueryClient();
  const invalidate = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["inventory"] }),
      client.invalidateQueries({ queryKey: ["sales-order-fulfilment"] }),
    ]);
  };
  const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const create = useMutation({ mutationFn: (payload: ReturnDraft & { delivery_id: number }) => request<InventoryReturn>("/inventory/returns", json("POST", payload)), onSuccess: invalidate });
  const update = useMutation({ mutationFn: ({ id, payload }: { id: number; payload: ReturnDraft }) => request<InventoryReturn>(`/inventory/returns/${id}`, json("PATCH", payload)), onSuccess: invalidate });
  const receive = useMutation({ mutationFn: (id: number) => request<InventoryReturn>(`/inventory/returns/${id}/receive`, { method: "POST" }), onSuccess: invalidate });
  const cancel = useMutation({ mutationFn: ({ id, reason }: { id: number; reason: string }) => request<InventoryReturn>(`/inventory/returns/${id}/cancel`, json("POST", { reason })), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: number) => request<void>(`/inventory/returns/${id}`, { method: "DELETE" }), onSuccess: invalidate });
  return {
    create: create.mutateAsync, update: update.mutateAsync, receive: receive.mutateAsync, cancel: cancel.mutateAsync, remove: remove.mutateAsync,
    isSaving: create.isPending || update.isPending || receive.isPending || cancel.isPending || remove.isPending,
  };
}
