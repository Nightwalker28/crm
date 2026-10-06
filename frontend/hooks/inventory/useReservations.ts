"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { Delivery } from "@/hooks/inventory/useDeliveries";
import type { InventoryReturn } from "@/hooks/inventory/useReturns";
import { apiFetch } from "@/lib/api";
import { apiErrorFromResponse } from "@/lib/apiErrors";

export type Availability = "reserved" | "partly_reserved" | "waiting";

export type OrderFulfilmentLine = {
  order_line_id: number; name: string; product_id: number | null; tracked: boolean;
  ordered: string; delivered: string; returned: string; reserved: string; to_deliver: string; waiting: string;
  /** Free stock in the order's warehouse; null without inventory access or for untracked lines. */
  available: string | null;
  availability: Availability | null;
};

export type OrderFulfilment = {
  order_id: number; order_number: string | null; status: string; delivery_status: string;
  remaining_closed_at: string | null; remaining_close_reason: string | null;
  warehouse_id: number; warehouse_name: string | null;
  availability: Availability | null; lines: OrderFulfilmentLine[];
  deliveries: Delivery[]; returns: InventoryReturn[];
};

export type ReservationLine = {
  order_line_id: number; order_id: number; order_number: string; customer_name: string | null;
  confirmed_at: string; priority: string; delivery_date: string | null; to_deliver: string; reserved: string; manual: boolean;
};

export type ProductReservations = {
  product_id: number; product_name: string; sku: string | null;
  warehouse_id: number; warehouse_name: string; warehouses: Array<{ id: number; name: string }>;
  on_hand: string; reserved: string; available: string; version: string; lines: ReservationLine[];
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) throw await apiErrorFromResponse(response, "Reservations could not be loaded.");
  return response.json() as Promise<T>;
}

export function useOrderFulfilment(orderId: number | null) {
  return useQuery({
    queryKey: ["sales-order-fulfilment", orderId],
    queryFn: () => request<OrderFulfilment>(`/sales/orders/${orderId}/fulfilment`),
    enabled: orderId !== null,
  });
}

export function useProductReservations(productId: number | null, warehouseId: number | null) {
  return useQuery({
    queryKey: ["inventory", "reservations", productId, warehouseId],
    queryFn: () => request<ProductReservations>(`/inventory/products/${productId}/reservations${warehouseId ? `?warehouse_id=${warehouseId}` : ""}`),
    enabled: productId !== null,
  });
}

export function useReservationActions() {
  const client = useQueryClient();
  const invalidate = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["inventory"] }),
      client.invalidateQueries({ queryKey: ["sales-order-fulfilment"] }),
    ]);
  };
  const reserveOrder = useMutation({
    mutationFn: (orderId: number) => request<OrderFulfilment>(`/sales/orders/${orderId}/reserve`, { method: "POST" }),
    onSuccess: invalidate,
  });
  const saveReservations = useMutation({
    mutationFn: ({ productId, payload }: { productId: number; payload: { warehouse_id: number; version: string; holds: Array<{ order_line_id: number; quantity: string }> } }) =>
      request<ProductReservations>(`/inventory/products/${productId}/reservations`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      }),
    onSuccess: invalidate,
  });
  return { reserveOrder: reserveOrder.mutateAsync, saveReservations: saveReservations.mutateAsync, isSaving: reserveOrder.isPending || saveReservations.isPending };
}
