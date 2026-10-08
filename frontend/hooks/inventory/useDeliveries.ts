"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { InventoryReturn } from "@/hooks/inventory/useReturns";
import { apiFetch } from "@/lib/api";
import { apiErrorFromResponse } from "@/lib/apiErrors";

export type DeliveryStatus = "draft" | "posted" | "cancelled";

export type DeliveryLine = {
  id: number; order_line_id: number; product_id: number; name: string; sku: string | null;
  quantity: string; ordered: string | null; to_deliver: string | null; returned: string;
};

export type Delivery = {
  /** The one field system (13b §3.4). */
  custom_fields?: Record<string, unknown> | null;
  id: number; number: string; status: DeliveryStatus; order_id: number; order_number: string | null; customer_name: string | null;
  contact_name: string | null; delivery_address: string | null;
  warehouse_id: number; warehouse_name: string | null; shipped_on: string | null; carrier: string | null; tracking_number: string | null;
  notes: string | null; posted_at: string | null; posted_by: number | null; cancel_reason: string | null; migrated: boolean;
  created_at: string; is_deleted: boolean; line_count: number; total_quantity: string; lines?: DeliveryLine[];
  returns?: InventoryReturn[];
};

export type DeliveryDraft = {
  shipped_on: string | null; carrier: string | null; tracking_number: string | null; notes: string | null;
  lines: Array<{ order_line_id: number; quantity: string }>;
};


async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) throw await apiErrorFromResponse(response, "Deliveries could not be loaded.");
  return response.status === 204 ? (null as T) : (response.json() as Promise<T>);
}


export function useDelivery(id: number | null) {
  return useQuery({ queryKey: ["inventory", "deliveries", "record", id], queryFn: () => request<Delivery>(`/inventory/deliveries/${id}`), enabled: id !== null });
}

export function useDeliveryActions() {
  const client = useQueryClient();
  const invalidate = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["inventory"] }),
      client.invalidateQueries({ queryKey: ["sales-order-fulfilment"] }),
      client.invalidateQueries({ queryKey: ["sales-order"] }),
      client.invalidateQueries({ queryKey: ["sales-orders"] }),
    ]);
  };
  const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const create = useMutation({ mutationFn: (payload: DeliveryDraft & { order_id: number }) => request<Delivery>("/inventory/deliveries", json("POST", payload)), onSuccess: invalidate });
  const update = useMutation({ mutationFn: ({ id, payload }: { id: number; payload: DeliveryDraft }) => request<Delivery>(`/inventory/deliveries/${id}`, json("PATCH", payload)), onSuccess: invalidate });
  const post = useMutation({ mutationFn: (id: number) => request<Delivery>(`/inventory/deliveries/${id}/post`, { method: "POST" }), onSuccess: invalidate });
  const cancel = useMutation({ mutationFn: ({ id, reason }: { id: number; reason: string }) => request<Delivery>(`/inventory/deliveries/${id}/cancel`, json("POST", { reason })), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: number) => request<void>(`/inventory/deliveries/${id}`, { method: "DELETE" }), onSuccess: invalidate });
  const closeRemaining = useMutation({ mutationFn: ({ orderId, reason }: { orderId: number; reason: string }) => request<unknown>(`/sales/orders/${orderId}/close-remaining`, json("POST", { reason })), onSuccess: invalidate });
  return {
    create: create.mutateAsync, update: update.mutateAsync, post: post.mutateAsync, cancel: cancel.mutateAsync, remove: remove.mutateAsync,
    closeRemaining: closeRemaining.mutateAsync,
    isSaving: create.isPending || update.isPending || post.isPending || cancel.isPending || remove.isPending || closeRemaining.isPending,
  };
}
