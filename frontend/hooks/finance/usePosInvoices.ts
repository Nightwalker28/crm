"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import { apiErrorFromBody } from "@/lib/apiErrors";
import { appendSavedViewFilterParams } from "@/lib/savedViewQuery";
import type { SavedViewFilters } from "@/hooks/useSavedViews";
import { usePagedList } from "@/hooks/usePagedList";

// E5 (12c-erp-invoicing.md §3.3): issued is final; payment status is derived from payments.
export type PosInvoiceStatus = "draft" | "issued" | "void";
export type PosPaymentStatus = "unpaid" | "partial" | "paid";
export type PosTemplateId = "modern" | "classic" | "compact";
export type PosInvoiceSortState = { key: string; direction: "asc" | "desc" } | null;

export type PosInvoiceLine = {
  id?: number;
  catalog_product_id?: number | null;
  catalog_service_id?: number | null;
  sales_order_item_id?: number | null;
  delivery_line_id?: number | null;
  description: string;
  quantity: number;
  unit_price: number;
  discount_amount?: number;
  tax_amount?: number;
  line_total?: number;
  sort_order?: number;
  creditable?: number | null;
};

export type PaymentAllocation = { id: number; document_type: "invoice" | "credit_note" | "bill"; document_id: number; document_label: string | null; amount: string };

export type PaymentRecord = {
  /** The one field system (13b §3.4). */
  custom_fields?: Record<string, unknown> | null;
  id: number; number: string; direction: "received" | "made"; kind: "payment" | "refund"; status: "posted" | "void";
  organization_id: number | null; contact_id: number | null; party_name: string | null; amount: string; currency: string;
  paid_on: string; method: string | null; reference: string | null; notes: string | null; voided_at: string | null;
  void_reason: string | null; created_by: number | null; created_at: string; allocated: string; allocations: PaymentAllocation[];
};

export type InvoiceCreditNoteSummary = {
  id: number; number: string | null; status: "draft" | "issued" | "void"; issue_date: string | null; reason: string | null;
  total_amount: string; refund_due: string; currency: string;
};

export type PosInvoice = {
  /** The one field system (13b §3.4). */
  custom_fields?: Record<string, unknown> | null;
  id: number;
  invoice_number: string | null;
  mode: string;
  source?: "manual" | "pos" | "sales_order";
  sales_order_id?: number | null;
  sales_order_number?: string | null;
  status: PosInvoiceStatus;
  payment_status: PosPaymentStatus;
  is_overdue?: boolean;
  payment_method?: string | null;
  template_id: PosTemplateId;
  accent_color: string;
  customer_name: string;
  customer_email?: string | null;
  customer_address?: string | null;
  customer_contact_id?: number | null;
  customer_organization_id?: number | null;
  customer_contact_name?: string | null;
  customer_organization_name?: string | null;
  issue_date?: string | null;
  due_date?: string | null;
  currency: string;
  subtotal_amount: number;
  discount_amount: number;
  tax_rate: number;
  tax_amount: number;
  total_amount: number;
  amount_paid: number;
  amount_credited?: number;
  balance_due: number;
  payment_terms?: string | null;
  notes?: string | null;
  issued_at?: string | null;
  voided_at?: string | null;
  void_reason?: string | null;
  user_name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  lines?: PosInvoiceLine[];
  payments?: PaymentRecord[];
  credit_notes?: InvoiceCreditNoteSummary[];
};

export type RecordPaymentPayload = { amount: number; payment_method?: string | null; paid_on?: string | null; reference?: string | null; notes?: string | null; custom_fields?: Record<string, unknown> };

/** What a draft or issued invoice shows as its number. */
export function invoiceDisplayNumber(invoice: Pick<PosInvoice, "invoice_number" | "status">) {
  return invoice.invoice_number || "Draft invoice";
}

type PosInvoicesResponse = {
  results: PosInvoice[];
  range_start: number;
  range_end: number;
  total_count: number;
  total_pages: number;
  page: number;
  page_size: number;
};

async function fetchInvoices(
  page: number,
  pageSize: number,
  search: string,
  status: string,
  sort: PosInvoiceSortState,
  paymentStatus = "all",
  filters?: SavedViewFilters,
): Promise<PosInvoicesResponse> {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (search.trim()) params.set("search", search.trim());
  if (status !== "all") params.set("status", status);
  if (paymentStatus !== "all") params.set("payment_status", paymentStatus);
  if (filters) appendSavedViewFilterParams(params, filters);
  if (sort) {
    params.set("sort_by", sort.key);
    params.set("sort_direction", sort.direction);
  }
  const res = await apiFetch(`/finance/invoices?${params.toString()}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error("Invoices could not be loaded.");
  return body as PosInvoicesResponse;
}

/**
 * Carries the HTTP status so a caller can tell "you may not see this" from "this is gone"
 * from "the request failed" — the three §7.4 states the record archetype renders separately.
 */
export class PosInvoiceRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function fetchPosInvoice(id: number): Promise<PosInvoice> {
  const res = await apiFetch(`/finance/invoices/${id}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new PosInvoiceRequestError(
      body?.detail ?? "The invoice could not be loaded.",
      res.status,
    );
  }
  return body as PosInvoice;
}

export function usePosInvoice(id: number | null) {
  return useQuery({
    queryKey: ["pos-invoice", id],
    queryFn: () => fetchPosInvoice(id as number),
    enabled: id !== null,
    staleTime: 30_000,
  });
}

async function recordInvoicePayment(id: number, payload: RecordPaymentPayload): Promise<PosInvoice> {
  const res = await apiFetch(`/finance/invoices/${id}/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  // Generic on purpose: payment failures never echo backend detail (payments-revamp.spec.ts).
  if (!res.ok) throw new Error("We could not record this payment.");
  return body as PosInvoice;
}

async function invoiceAction(path: string, payload?: unknown): Promise<PosInvoice> {
  const res = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw apiErrorFromBody(res.status, body, "The invoice could not be changed.");
  return body as PosInvoice;
}

/**
 * The invoice lifecycle (12c §3.3): issue a draft, void an issued invoice, void it and open
 * a corrected copy, record a payment, and draft an invoice from an order or delivery.
 */
export function useInvoiceActions() {
  const queryClient = useQueryClient();
  const refresh = async (invoice?: PosInvoice) => {
    if (invoice) queryClient.setQueryData(["pos-invoice", invoice.id], invoice);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["pos-invoices"] }),
      queryClient.invalidateQueries({ queryKey: ["pos-invoice"] }),
      queryClient.invalidateQueries({ queryKey: ["finance-payments"] }),
      queryClient.invalidateQueries({ queryKey: ["sales-order-invoicing"] }),
      queryClient.invalidateQueries({ queryKey: ["record-audit-history", "finance_pos"] }),
    ]);
  };
  const issue = useMutation({ mutationFn: (id: number) => invoiceAction(`/finance/invoices/${id}/issue`), onSuccess: refresh });
  const voidInvoice = useMutation({ mutationFn: ({ id, reason }: { id: number; reason: string }) => invoiceAction(`/finance/invoices/${id}/void`, { reason }), onSuccess: refresh });
  const voidAndCopy = useMutation({ mutationFn: ({ id, reason }: { id: number; reason: string }) => invoiceAction(`/finance/invoices/${id}/void-and-copy`, { reason }), onSuccess: () => refresh() });
  const pay = useMutation({ mutationFn: ({ id, payload }: { id: number; payload: RecordPaymentPayload }) => recordInvoicePayment(id, payload), onSuccess: refresh });
  const fromSource = useMutation({
    mutationFn: (source: { order_id: number; delivery_id?: number | null }) => invoiceAction("/finance/invoices/from-order", { sources: [source] }),
    onSuccess: refresh,
  });
  const all = [issue, voidInvoice, voidAndCopy, pay, fromSource];
  return {
    issue: issue.mutateAsync,
    voidInvoice: voidInvoice.mutateAsync,
    voidAndCopy: voidAndCopy.mutateAsync,
    recordPayment: pay.mutateAsync,
    draftFromSource: fromSource.mutateAsync,
    isSaving: all.some((mutation) => mutation.isPending),
  };
}

export function usePaymentInvoices(filters: SavedViewFilters, sort: PosInvoiceSortState = null) {
  const queryClient = useQueryClient();
  const paged = usePagedList<PosInvoice, PosInvoicesResponse>({
    queryKey: ["pos-invoices", "payments"],
    fetcher: (page, pageSize, viewFilters, _visibleColumns, sortState) => {
      const search = typeof viewFilters.search === "string" ? viewFilters.search : "";
      const invoiceStatus = typeof viewFilters.status === "string" ? viewFilters.status : "all";
      const paymentStatus = typeof viewFilters.payment_status === "string" ? viewFilters.payment_status : "all";
      return fetchInvoices(page, pageSize, search, invoiceStatus, sortState, paymentStatus, viewFilters);
    },
    visibleColumns: [],
    filters,
    sort,
    initialPage: 1,
    initialPageSize: 10,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    errorMessage: () => "We could not load payments.",
  });
  const paymentMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: RecordPaymentPayload }) => recordInvoicePayment(id, payload),
    onSuccess: async (invoice) => {
      queryClient.setQueryData(["pos-invoice", invoice.id], invoice);
      await queryClient.invalidateQueries({ queryKey: ["pos-invoices"] });
    },
  });

  return {
    invoices: paged.items,
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
    recordPayment: (id: number, payload: RecordPaymentPayload) => paymentMutation.mutateAsync({ id, payload }),
    isRecordingPayment: paymentMutation.isPending,
  };
}

export function useInvoiceList(filters: SavedViewFilters, sort: PosInvoiceSortState = null) {
  const paged = usePagedList<PosInvoice, PosInvoicesResponse>({
    queryKey: ["pos-invoices", "list"],
    fetcher: (page, pageSize, viewFilters, _visibleColumns, sortState) => {
      const search = typeof viewFilters.search === "string" ? viewFilters.search : "";
      const invoiceStatus = typeof viewFilters.status === "string" ? viewFilters.status : "all";
      const paymentStatus = typeof viewFilters.payment_status === "string" ? viewFilters.payment_status : "all";
      return fetchInvoices(page, pageSize, search, invoiceStatus, sortState, paymentStatus, viewFilters);
    },
    visibleColumns: [],
    filters,
    sort,
    initialPage: 1,
    initialPageSize: 10,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    errorMessage: () => "We could not load invoices.",
  });

  return {
    invoices: paged.items,
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
  };
}
