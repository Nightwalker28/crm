"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import { appendSavedViewFilterParams } from "@/lib/savedViewQuery";
import type { SavedViewFilters } from "@/hooks/useSavedViews";
import { usePagedList } from "@/hooks/usePagedList";

export type PosInvoiceStatus = "draft" | "issued" | "paid" | "void";
export type PosPaymentStatus = "unpaid" | "partial" | "paid" | "refunded";
export type PosTemplateId = "modern" | "classic" | "compact";
export type PosInvoiceSortState = { key: string; direction: "asc" | "desc" } | null;

export type PosInvoiceLine = {
  id?: number;
  catalog_product_id?: number | null;
  catalog_service_id?: number | null;
  description: string;
  quantity: number;
  unit_price: number;
  line_total?: number;
  sort_order?: number;
};

export type PosInvoice = {
  id: number;
  invoice_number: string;
  mode: string;
  status: PosInvoiceStatus;
  payment_status: PosPaymentStatus;
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
  balance_due: number;
  payment_terms?: string | null;
  notes?: string | null;
  user_name?: string | null;
  updated_at?: string | null;
  lines?: PosInvoiceLine[];
};

export type PosInvoicePayload = {
  customer_name: string;
  customer_contact_id?: number;
  customer_organization_id?: number;
  create_customer_if_missing?: boolean;
  customer_email?: string;
  customer_address?: string;
  invoice_number?: string;
  issue_date?: string;
  due_date?: string;
  status: PosInvoiceStatus;
  payment_status: PosPaymentStatus;
  payment_method?: string;
  template_id: PosTemplateId;
  accent_color: string;
  currency: string;
  discount_amount: number;
  tax_rate: number;
  amount_paid: number;
  payment_terms?: string;
  notes?: string;
  lines: PosInvoiceLine[];
};

export type PosInvoiceUpdatePayload = Partial<PosInvoicePayload>;
export type RecordPaymentPayload = { amount: number; payment_method?: string | null };

type PosInvoicesResponse = {
  results: PosInvoice[];
  range_start: number;
  range_end: number;
  total_count: number;
  total_pages: number;
  page: number;
  page_size: number;
};

function errorMessage(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "detail" in body && typeof body.detail === "string") return body.detail;
  return fallback;
}

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
  const res = await apiFetch(`/finance/pos-invoices?${params.toString()}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(errorMessage(body, `Failed with ${res.status}`));
  return body as PosInvoicesResponse;
}

export async function fetchPosInvoice(id: number): Promise<PosInvoice> {
  const res = await apiFetch(`/finance/pos-invoices/${id}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(errorMessage(body, `Failed with ${res.status}`));
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

async function createInvoice(payload: PosInvoicePayload): Promise<PosInvoice> {
  const res = await apiFetch("/finance/pos-invoices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(errorMessage(body, `Failed with ${res.status}`));
  return body as PosInvoice;
}

async function updateInvoice(id: number, payload: PosInvoiceUpdatePayload): Promise<PosInvoice> {
  const res = await apiFetch(`/finance/pos-invoices/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(errorMessage(body, `Failed with ${res.status}`));
  return body as PosInvoice;
}

async function recordInvoicePayment(id: number, payload: RecordPaymentPayload): Promise<PosInvoice> {
  const res = await apiFetch(`/finance/pos-invoices/${id}/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(errorMessage(body, "We could not record this payment."));
  return body as PosInvoice;
}

async function deleteInvoice(id: number): Promise<void> {
  const res = await apiFetch(`/finance/pos-invoices/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(errorMessage(body, `Failed with ${res.status}`));
  }
}

export function usePosInvoices(
  page: number,
  pageSize: number,
  search: string,
  status: string,
  sort: PosInvoiceSortState = null,
) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["pos-invoices", page, pageSize, search, status, sort],
    queryFn: () => fetchInvoices(page, pageSize, search, status, sort),
    placeholderData: (previous) => previous,
  });
  const createMutation = useMutation({
    mutationFn: createInvoice,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pos-invoices"] }),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: PosInvoiceUpdatePayload }) => updateInvoice(id, payload),
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["pos-invoices"] }),
        queryClient.invalidateQueries({ queryKey: ["pos-invoice", variables.id] }),
      ]);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteInvoice,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pos-invoices"] }),
  });

  return {
    invoices: query.data?.results ?? [],
    rangeStart: query.data?.range_start ?? 0,
    rangeEnd: query.data?.range_end ?? 0,
    totalCount: query.data?.total_count ?? 0,
    totalPages: query.data?.total_pages ?? 1,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error instanceof Error ? query.error.message : null,
    refresh: query.refetch,
    createInvoice: createMutation.mutateAsync,
    updateInvoice: (id: number, payload: PosInvoiceUpdatePayload) => updateMutation.mutateAsync({ id, payload }),
    deleteInvoice: deleteMutation.mutateAsync,
    isSaving: createMutation.isPending || updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
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
    errorMessage: (error) => error instanceof Error ? error.message : "We could not load payments.",
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
    errorMessage: (error) => error instanceof Error ? error.message : "We could not load invoices.",
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
