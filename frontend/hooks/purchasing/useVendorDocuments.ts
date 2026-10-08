"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PaymentRecord } from "@/hooks/finance/usePosInvoices";
import { apiFetch } from "@/lib/api";
import { apiErrorFromResponse } from "@/lib/apiErrors";

/** Goods sent back to a vendor against a posted receipt (13c §3.7). */
export type VendorReturn = {
  custom_fields?: Record<string, unknown> | null;
  id: number; number: string; status: "draft" | "shipped" | "cancelled"; resolution: "credit" | "replace"; reason: string; notes: string | null;
  vendor_id: number; vendor_name: string | null; order_id: number; order_number: string | null; currency: string | null;
  receipt_id: number; receipt_number: string | null; warehouse_id: number; shipped_at: string | null; cancel_reason: string | null;
  owner_id: number | null; created_at: string; updated_at: string; is_deleted: boolean; line_count: number; total_quantity: string;
  credits: Array<{ id: number; number: string | null; status: string; total: string; currency: string }>;
  lines?: Array<{ id: number; receipt_line_id: number; order_line_id: number; product_id: number; product_name: string; sku: string | null;
    quantity: string; unit_cost: string | null; returnable: string | null }>;
};

export type VendorReturnDraft = {
  custom_fields?: Record<string, unknown> | null;
  reason?: string | null; resolution?: "credit" | "replace"; notes?: string | null;
  lines?: Array<{ receipt_line_id: number; quantity: string }>;
};

/** What a vendor owes back (13c §3.6). */
export type VendorCredit = {
  custom_fields?: Record<string, unknown> | null;
  id: number; number: string | null; status: "draft" | "issued" | "void"; vendor_id: number; vendor_name: string | null;
  bill_id: number | null; bill_number: string | null; vendor_return_id: number | null; vendor_return_number: string | null;
  vendor_reference: string | null; credit_date: string | null; currency: string; subtotal: string; tax_total: string; total: string;
  credit_remaining: string; reason: string | null; notes: string | null; issued_at: string | null; voided_at: string | null;
  void_reason: string | null; owner_id: number | null; created_at: string; updated_at: string; is_deleted: boolean;
  lines?: Array<{ id: number; bill_line_id: number | null; vendor_return_line_id: number | null; catalog_product_id: number | null;
    catalog_service_id: number | null; description: string; quantity: string; unit_cost: string; tax_amount: string; line_total: string }>;
  applications?: Array<{ id: number; bill_id: number; bill_number: string; amount: string; created_at: string }>;
  refunds?: PaymentRecord[];
  open_bills?: Array<{ id: number; number: string; vendor_invoice_number: string; due_date: string | null; balance_due: string; currency: string }>;
};

export type VendorCreditDraft = {
  custom_fields?: Record<string, unknown> | null;
  vendor_id?: number | null; vendor_reference?: string | null; credit_date?: string | null; currency?: string | null;
  reason?: string | null; notes?: string | null;
  lines?: Array<{ bill_line_id?: number | null; vendor_return_line_id?: number | null; catalog_product_id?: number | null;
    catalog_service_id?: number | null; description?: string | null; quantity: string; unit_cost?: string | null; tax_amount?: string | null }>;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(`/purchasing${path}`, init);
  if (!response.ok) throw await apiErrorFromResponse(response, "The vendor document could not be loaded.");
  return response.status === 204 ? (null as T) : (response.json() as Promise<T>);
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function useVendorReturn(id: number | null) {
  return useQuery({ queryKey: ["purchasing", "vendor-returns", "record", id], queryFn: () => request<VendorReturn>(`/vendor-returns/${id}`), enabled: id !== null });
}

/** A vendor return as its receipt and purchase order list it. */
export type VendorReturnSummary = { id: number; number: string; status: string; resolution: "credit" | "replace"; reason: string; total_quantity: string };

export function useReceiptVendorReturns(receiptId: number | null) {
  return useQuery({
    queryKey: ["purchasing", "vendor-returns", "receipt", receiptId],
    queryFn: async () => (await request<{ results: VendorReturnSummary[] }>(`/receipts/${receiptId}/vendor-returns`)).results,
    enabled: receiptId !== null,
  });
}

export function useVendorCredit(id: number | null) {
  return useQuery({ queryKey: ["purchasing", "vendor-credits", "record", id], queryFn: () => request<VendorCredit>(`/vendor-credits/${id}`), enabled: id !== null });
}

export function useVendorDocumentActions() {
  const client = useQueryClient();
  const invalidate = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["purchasing"] }),
      client.invalidateQueries({ queryKey: ["inventory"] }),
      client.invalidateQueries({ queryKey: ["document-list"] }),
      client.invalidateQueries({ queryKey: ["finance-payments"] }),
    ]);
  };
  const createReturn = useMutation({ mutationFn: (payload: VendorReturnDraft & { receipt_id: number }) => request<VendorReturn>("/vendor-returns", json("POST", payload)), onSuccess: invalidate });
  const updateReturn = useMutation({ mutationFn: ({ id, payload }: { id: number; payload: VendorReturnDraft }) => request<VendorReturn>(`/vendor-returns/${id}`, json("PATCH", payload)), onSuccess: invalidate });
  const shipReturn = useMutation({ mutationFn: (id: number) => request<VendorReturn>(`/vendor-returns/${id}/ship`, { method: "POST" }), onSuccess: invalidate });
  const cancelReturn = useMutation({ mutationFn: ({ id, reason }: { id: number; reason: string }) => request<VendorReturn>(`/vendor-returns/${id}/cancel`, json("POST", { reason })), onSuccess: invalidate });
  const removeReturn = useMutation({ mutationFn: (id: number) => request<void>(`/vendor-returns/${id}`, { method: "DELETE" }), onSuccess: invalidate });
  const createCredit = useMutation({
    mutationFn: (payload: VendorCreditDraft & { bill_id?: number | null; vendor_return_id?: number | null }) => request<VendorCredit>("/vendor-credits", json("POST", payload)),
    onSuccess: invalidate,
  });
  const updateCredit = useMutation({ mutationFn: ({ id, payload }: { id: number; payload: VendorCreditDraft }) => request<VendorCredit>(`/vendor-credits/${id}`, json("PATCH", payload)), onSuccess: invalidate });
  const issueCredit = useMutation({ mutationFn: (id: number) => request<VendorCredit>(`/vendor-credits/${id}/issue`, { method: "POST" }), onSuccess: invalidate });
  const applyCredit = useMutation({
    mutationFn: ({ id, allocations }: { id: number; allocations: Array<{ bill_id: number; amount: string }> }) => request<VendorCredit>(`/vendor-credits/${id}/apply`, json("POST", { allocations })),
    onSuccess: invalidate,
  });
  const voidCredit = useMutation({ mutationFn: ({ id, reason }: { id: number; reason: string }) => request<VendorCredit>(`/vendor-credits/${id}/void`, json("POST", { reason })), onSuccess: invalidate });
  const removeCredit = useMutation({ mutationFn: (id: number) => request<void>(`/vendor-credits/${id}`, { method: "DELETE" }), onSuccess: invalidate });
  const all = [createReturn, updateReturn, shipReturn, cancelReturn, removeReturn, createCredit, updateCredit, issueCredit, applyCredit, voidCredit, removeCredit];
  return {
    createReturn: createReturn.mutateAsync, updateReturn: updateReturn.mutateAsync, shipReturn: shipReturn.mutateAsync,
    cancelReturn: cancelReturn.mutateAsync, removeReturn: removeReturn.mutateAsync,
    createCredit: createCredit.mutateAsync, updateCredit: updateCredit.mutateAsync, issueCredit: issueCredit.mutateAsync,
    applyCredit: applyCredit.mutateAsync, voidCredit: voidCredit.mutateAsync, removeCredit: removeCredit.mutateAsync,
    isSaving: all.some((item) => item.isPending),
  };
}
