"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PaymentRecord } from "@/hooks/finance/usePosInvoices";
import { apiFetch } from "@/lib/api";
import { apiErrorFromResponse } from "@/lib/apiErrors";

/** Credit notes, payment records and an order's invoicing (12c-erp-invoicing.md §3.5). */

export type CreditNoteLine = {
  id: number; invoice_line_id: number; return_line_id: number | null; description: string; quantity: string; unit_price: string;
  discount_amount: string; tax_amount: string; line_total: string; creditable: string;
};

export type CreditNote = {
  id: number; number: string | null; status: "draft" | "issued" | "void"; invoice_id: number; invoice_number: string | null;
  customer_name: string | null; customer_organization_id: number | null; customer_contact_id: number | null; return_id: number | null;
  reason: string | null; issue_date: string | null; currency: string; subtotal_amount: string; discount_amount: string; tax_amount: string;
  total_amount: string; refund_due: string; applied_amount: string | null; notes: string | null; issued_at: string | null;
  voided_at: string | null; void_reason: string | null; created_at: string; updated_at: string; is_deleted: boolean;
  lines?: CreditNoteLine[]; refunds?: PaymentRecord[];
};

export type CreditNoteDraft = {
  reason?: string | null; notes?: string | null; issue_date?: string | null;
  lines?: Array<{ invoice_line_id: number; quantity: string; return_line_id?: number | null }>;
};

export type ReturnCreditCandidates = {
  return_id: number; return_number: string; status: string;
  candidates: Array<{ invoice_id: number; invoice_number: string | null; lines: Array<{ invoice_line_id: number; description: string; quantity: string; return_line_id: number | null }> }>;
};

export type OrderInvoicingLine = {
  order_line_id: number; name: string; tracked: boolean; basis: "ordered" | "delivered"; ordered: string; delivered: string; returned: string;
  invoiceable: string; final: string; invoiced: string; on_drafts: string; to_invoice: string; unit_price: string;
};

export type OrderInvoicing = {
  order_id: number; status: string; invoice_status: string; currency: string; policy: "delivered" | "ordered";
  lines: OrderInvoicingLine[];
  invoices: Array<{ id: number; invoice_number: string | null; status: string; payment_status: string; issue_date: string | null;
    due_date: string | null; total_amount: string; balance_due: string; currency: string }>;
};

export type PaymentDraft = {
  direction: "received" | "made"; kind?: "payment" | "refund"; paid_on?: string | null; method?: string | null; reference?: string | null;
  notes?: string | null; allocations: Array<{ invoice_id?: number; credit_note_id?: number; bill_id?: number; amount: string }>;
};

type Page<T> = { results: T[]; page: number; page_size: number; total_count: number; total_pages: number; range_start: number; range_end: number };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) throw await apiErrorFromResponse(response, "This could not be loaded.");
  return response.status === 204 ? (null as T) : (response.json() as Promise<T>);
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function useCreditNotes(page: number, pageSize: number, status: string, search: string) {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (status) params.set("status", status);
  if (search.trim()) params.set("search", search.trim());
  return useQuery({ queryKey: ["finance-credit-notes", page, pageSize, status, search], queryFn: () => request<Page<CreditNote>>(`/finance/credit-notes?${params}`), placeholderData: keepPreviousData });
}

export function useCreditNote(id: number | null) {
  return useQuery({ queryKey: ["finance-credit-notes", "record", id], queryFn: () => request<CreditNote>(`/finance/credit-notes/${id}`), enabled: id !== null });
}

export function useReturnCreditCandidates(returnId: number | null) {
  return useQuery({
    queryKey: ["finance-credit-notes", "return-candidates", returnId],
    queryFn: () => request<ReturnCreditCandidates>(`/finance/credit-notes/return-candidates?return_id=${returnId}`),
    enabled: returnId !== null,
  });
}

export function usePayments(page: number, pageSize: number, filters: { direction: string; status: string; search: string }) {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (filters.direction) params.set("direction", filters.direction);
  if (filters.status) params.set("status", filters.status);
  if (filters.search.trim()) params.set("search", filters.search.trim());
  return useQuery({ queryKey: ["finance-payments", page, pageSize, filters], queryFn: () => request<Page<PaymentRecord>>(`/finance/payments?${params}`), placeholderData: keepPreviousData });
}

export function usePayment(id: number | null) {
  return useQuery({ queryKey: ["finance-payments", "record", id], queryFn: () => request<PaymentRecord>(`/finance/payments/${id}`), enabled: id !== null });
}

export function useOrderInvoicing(orderId: number | null, enabled = true) {
  return useQuery({
    queryKey: ["sales-order-invoicing", orderId],
    queryFn: () => request<OrderInvoicing>(`/sales/orders/${orderId}/invoicing`),
    enabled: enabled && orderId !== null,
  });
}

export function useFinanceDocumentActions() {
  const client = useQueryClient();
  const invalidate = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["finance-credit-notes"] }),
      client.invalidateQueries({ queryKey: ["finance-payments"] }),
      client.invalidateQueries({ queryKey: ["pos-invoices"] }),
      client.invalidateQueries({ queryKey: ["pos-invoice"] }),
      client.invalidateQueries({ queryKey: ["purchasing"] }),
      client.invalidateQueries({ queryKey: ["sales-order-invoicing"] }),
    ]);
  };
  const createCreditNote = useMutation({
    mutationFn: (payload: CreditNoteDraft & { invoice_id: number; return_id?: number | null }) => request<CreditNote>("/finance/credit-notes", json("POST", payload)),
    onSuccess: invalidate,
  });
  const updateCreditNote = useMutation({ mutationFn: ({ id, payload }: { id: number; payload: CreditNoteDraft }) => request<CreditNote>(`/finance/credit-notes/${id}`, json("PUT", payload)), onSuccess: invalidate });
  const issueCreditNote = useMutation({ mutationFn: (id: number) => request<CreditNote>(`/finance/credit-notes/${id}/issue`, { method: "POST" }), onSuccess: invalidate });
  const voidCreditNote = useMutation({ mutationFn: ({ id, reason }: { id: number; reason: string }) => request<CreditNote>(`/finance/credit-notes/${id}/void`, json("POST", { reason })), onSuccess: invalidate });
  const removeCreditNote = useMutation({ mutationFn: (id: number) => request<void>(`/finance/credit-notes/${id}`, { method: "DELETE" }), onSuccess: invalidate });
  const recordPayment = useMutation({ mutationFn: (payload: PaymentDraft) => request<PaymentRecord>("/finance/payments", json("POST", payload)), onSuccess: invalidate });
  const voidPayment = useMutation({ mutationFn: ({ id, reason }: { id: number; reason: string }) => request<PaymentRecord>(`/finance/payments/${id}/void`, json("POST", { reason })), onSuccess: invalidate });
  const all = [createCreditNote, updateCreditNote, issueCreditNote, voidCreditNote, removeCreditNote, recordPayment, voidPayment];
  return {
    createCreditNote: createCreditNote.mutateAsync, updateCreditNote: updateCreditNote.mutateAsync, issueCreditNote: issueCreditNote.mutateAsync,
    voidCreditNote: voidCreditNote.mutateAsync, removeCreditNote: removeCreditNote.mutateAsync,
    recordPayment: recordPayment.mutateAsync, voidPayment: voidPayment.mutateAsync,
    isSaving: all.some((mutation) => mutation.isPending),
  };
}
