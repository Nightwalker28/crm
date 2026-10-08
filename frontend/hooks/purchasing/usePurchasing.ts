"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PaymentRecord } from "@/hooks/finance/usePosInvoices";
import { apiFetch } from "@/lib/api";
import { apiErrorFromResponse } from "@/lib/apiErrors";

/** `draft` and `sent` are a request for quotation (13c §3.8). */
export type PurchaseOrderStatus = "draft" | "sent" | "ordered" | "received" | "closed" | "cancelled";

export type PurchaseOrderLine = {
  /** A product (tracked or not) or a service (13c §3.5); `product_name` is either's name. */
  id: number; product_id: number | null; catalog_service_id?: number | null; kind?: "product" | "service";
  track_inventory?: boolean; needs_receipt?: boolean;
  product_name: string; sku: string | null; vendor_sku: string | null; description: string | null;
  quantity: string; unit_cost: string; discount_amount?: string;
  /** The unit cost after the line's discount: what a bill matches against. */
  net_unit_cost?: string;
  line_total: string; received: string; to_receive: string;
  billed?: string; to_bill?: string;
};

export type PurchaseOrder = {
  /** The one field system (13b §3.4). */
  custom_fields?: Record<string, unknown> | null;
  id: number; number: string; status: PurchaseOrderStatus; receipt_status: "none" | "partial" | "received";
  bill_status?: "none" | "to_bill" | "partial" | "billed";
  vendor_id: number; vendor_name: string | null; vendor_email?: string | null; vendor_address?: string | null;
  warehouse_id: number; warehouse_name: string | null; currency: string;
  /** E6: base-currency units per one unit of `currency`; null in the base currency (12d §3.1). */
  exchange_rate?: string | null; base_currency?: string; suggested_exchange_rate?: string | null;
  expected_date: string | null; vendor_reference: string | null; notes: string | null; subtotal: string;
  ordered_at: string | null; closed_at: string | null; close_reason: string | null; cancel_reason: string | null;
  created_at: string; updated_at: string; is_deleted: boolean; line_count: number; total_quantity: string;
  lines?: PurchaseOrderLine[];
  receipts?: Array<{ id: number; number: string; status: string; received_on: string | null; vendor_delivery_ref: string | null; total_quantity: string }>;
  bills?: PurchaseBill[];
  sent_at?: string | null;
  rfq_group_id?: number | null;
  /** The same request asked of other vendors (13c §3.8). */
  alternatives?: Array<{ id: number; number: string; status: PurchaseOrderStatus; vendor_name: string | null; subtotal: string; currency: string }>;
  vendor_returns?: Array<{ id: number; number: string; status: string; resolution: "credit" | "replace"; reason: string; total_quantity: string }>;
};

/** The comparison of an RFQ's alternatives (13c §3.8). */
export type RfqComparison = {
  group_id: number;
  vendors: Array<{ order_id: number; number: string; status: PurchaseOrderStatus; vendor_id: number; vendor_name: string | null; currency: string;
    subtotal: string; expected_date: string | null; sent_at: string | null; is_lowest: boolean }>;
  items: Array<{ kind: "product" | "service"; item_id: number; name: string; lowest_unit_cost: string | null;
    offers: Array<{ order_id: number; quantity: string; line_total: string; unit_cost: string | null }> }>;
};

export function useRfqComparison(orderId: number | null) {
  return useQuery({ queryKey: ["purchasing", "orders", "compare", orderId], queryFn: () => request<RfqComparison>(`/orders/${orderId}/compare`), enabled: orderId !== null });
}

// E5 vendor bills (12c-erp-invoicing.md §3.5).
export type PurchaseBillLine = {
  id: number; order_line_id: number | null; receipt_line_id: number | null; catalog_product_id: number | null; catalog_service_id: number | null;
  description: string; quantity: string; unit_cost: string; po_unit_cost: string | null; tax_amount: string; line_total: string;
  price_variance: boolean; received: string | null; billable: string | null;
  /** E6: what a price difference did to stock value and cost of goods (12d §3.2). */
  variance_stock_change?: string | null; variance_cogs_change?: string | null;
};

export type PurchaseBill = {
  /** The one field system (13b §3.4). */
  custom_fields?: Record<string, unknown> | null;
  id: number; number: string; status: "draft" | "posted" | "void"; payment_status: "unpaid" | "partial" | "paid";
  match_status: "none" | "matched" | "variance"; is_overdue: boolean; vendor_id: number; vendor_name: string | null;
  order_id: number | null; order_number: string | null; receipt_id: number | null; vendor_invoice_number: string;
  bill_date: string; due_date: string | null; currency: string; subtotal: string; tax_total: string; total: string;
  amount_paid: string; balance_due: string; notes: string | null; posted_at: string | null; voided_at: string | null;
  void_reason: string | null; created_at: string; updated_at: string; is_deleted: boolean;
  lines?: PurchaseBillLine[]; payments?: PaymentRecord[];
  /** Vendor credits drawn from or applied to this bill (13c §3.6). */
  vendor_credits?: Array<{ id: number; number: string | null; status: string; total: string; currency: string; applied: string }>;
};

export type PurchaseBillDraft = {
  vendor_id?: number | null; vendor_invoice_number: string; bill_date?: string | null; due_date?: string | null; currency?: string | null;
  notes?: string | null; order_id?: number | null; receipt_id?: number | null;
  lines?: Array<{ order_line_id?: number | null; receipt_line_id?: number | null; catalog_product_id?: number | null; catalog_service_id?: number | null;
    description?: string | null; quantity: string; unit_cost?: string | null; tax_amount?: string }>;
};

export type PurchaseOrderDraft = {
  vendor_id: number; warehouse_id?: number | null; currency?: string | null; exchange_rate?: string | null; expected_date: string | null; vendor_reference: string | null; notes: string | null;
  lines: Array<{ product_id: number | null; catalog_service_id?: number | null; description: string | null; quantity: string; unit_cost: string; discount_amount?: string }>;
};

export type ReceiptLine = {
  id: number; order_line_id: number; product_id: number; product_name: string; sku: string | null;
  quantity: string; ordered: string | null; unit_cost: string | null; to_receive: string | null;
  /** Held by vendor returns, drafts included (13c §3.7). */
  returned?: string; track_inventory?: boolean;
};

export type PurchaseReceipt = {
  /** The one field system (13b §3.4). */
  custom_fields?: Record<string, unknown> | null;
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


async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(`/purchasing${path}`, init);
  if (!response.ok) throw await apiErrorFromResponse(response, "Purchasing could not be loaded.");
  return response.status === 204 ? (null as T) : (response.json() as Promise<T>);
}

/** The unit cost a new line starts at for this vendor and item (13c §5 decision 7). */
export async function fetchLineCostDefault(vendorId: number, kind: "product" | "service", itemId: number): Promise<string | null> {
  const params = new URLSearchParams({ vendor_id: String(vendorId), [kind === "service" ? "service_id" : "product_id"]: String(itemId) });
  const body = await request<{ unit_cost: string | null }>(`/orders/line-defaults?${params}`);
  return body.unit_cost;
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });


export function usePurchaseOrder(id: number | null) {
  return useQuery({ queryKey: ["purchasing", "orders", "record", id], queryFn: () => request<PurchaseOrder>(`/orders/${id}`), enabled: id !== null });
}


export function usePurchaseReceipt(id: number | null) {
  return useQuery({ queryKey: ["purchasing", "receipts", "record", id], queryFn: () => request<PurchaseReceipt>(`/receipts/${id}`), enabled: id !== null });
}


export function usePurchaseBill(id: number | null) {
  return useQuery({ queryKey: ["purchasing", "bills", "record", id], queryFn: () => request<PurchaseBill>(`/bills/${id}`), enabled: id !== null });
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
      client.invalidateQueries({ queryKey: ["finance-payments"] }),
    ]);
  };
  const createOrder = useMutation({ mutationFn: (payload: PurchaseOrderDraft) => request<PurchaseOrder>("/orders", json("POST", payload)), onSuccess: invalidate });
  const updateOrder = useMutation({ mutationFn: ({ id, payload }: { id: number; payload: PurchaseOrderDraft }) => request<PurchaseOrder>(`/orders/${id}`, json("PATCH", payload)), onSuccess: invalidate });
  const setExchangeRate = useMutation({ mutationFn: ({ id, rate }: { id: number; rate: string }) => request<PurchaseOrder>(`/orders/${id}/exchange-rate`, json("PUT", { exchange_rate: rate })), onSuccess: invalidate });
  const placeOrder = useMutation({ mutationFn: (id: number) => request<PurchaseOrder>(`/orders/${id}/order`, { method: "POST" }), onSuccess: invalidate });
  const sendOrder = useMutation({ mutationFn: (id: number) => request<PurchaseOrder>(`/orders/${id}/send`, { method: "POST" }), onSuccess: invalidate });
  const createAlternative = useMutation({ mutationFn: ({ id, vendorId }: { id: number; vendorId: number }) => request<PurchaseOrder>(`/orders/${id}/alternatives`, json("POST", { vendor_id: vendorId })), onSuccess: invalidate });
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
  const createBill = useMutation({ mutationFn: (payload: PurchaseBillDraft) => request<PurchaseBill>("/bills", json("POST", payload)), onSuccess: invalidate });
  const updateBill = useMutation({ mutationFn: ({ id, payload }: { id: number; payload: PurchaseBillDraft }) => request<PurchaseBill>(`/bills/${id}`, json("PATCH", payload)), onSuccess: invalidate });
  const postBill = useMutation({ mutationFn: (id: number) => request<PurchaseBill>(`/bills/${id}/post`, { method: "POST" }), onSuccess: invalidate });
  const voidBill = useMutation({ mutationFn: ({ id, reason }: { id: number; reason: string }) => request<PurchaseBill>(`/bills/${id}/void`, json("POST", { reason })), onSuccess: invalidate });
  const removeBill = useMutation({ mutationFn: (id: number) => request<void>(`/bills/${id}`, { method: "DELETE" }), onSuccess: invalidate });
  const all = [sendOrder, createAlternative, setExchangeRate, createBill, updateBill, postBill, voidBill, removeBill, createOrder, updateOrder, placeOrder, closeOrder, cancelOrder, removeOrder, createReceipt, updateReceipt, postReceipt, cancelReceipt, removeReceipt, draftFromReorder];
  return {
    createOrder: createOrder.mutateAsync, updateOrder: updateOrder.mutateAsync, placeOrder: placeOrder.mutateAsync,
    sendOrder: sendOrder.mutateAsync, createAlternative: createAlternative.mutateAsync,
    closeOrder: closeOrder.mutateAsync, cancelOrder: cancelOrder.mutateAsync, removeOrder: removeOrder.mutateAsync,
    createReceipt: createReceipt.mutateAsync, updateReceipt: updateReceipt.mutateAsync, postReceipt: postReceipt.mutateAsync,
    cancelReceipt: cancelReceipt.mutateAsync, removeReceipt: removeReceipt.mutateAsync, draftFromReorder: draftFromReorder.mutateAsync,
    createBill: createBill.mutateAsync, updateBill: updateBill.mutateAsync, postBill: postBill.mutateAsync, voidBill: voidBill.mutateAsync,
    removeBill: removeBill.mutateAsync, setExchangeRate: setExchangeRate.mutateAsync,
    isSaving: all.some((item) => item.isPending),
  };
}
