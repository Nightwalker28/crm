"use client";

import { useDeferredValue, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";

export type InsertionOrderStatus = "draft" | "issued" | "active" | "completed" | "cancelled" | "imported";

export type InsertionOrder = {
  id: number;
  io_number: string;
  customer_name: string;
  customer_organization_id?: number | null;
  counterparty_reference?: string | null;
  external_reference?: string | null;
  issue_date?: string | null;
  effective_date?: string | null;
  due_date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status: string;
  currency: string;
  subtotal_amount?: number | null;
  tax_amount?: number | null;
  total_amount?: number | null;
  notes?: string | null;
  file_name?: string | null;
  file_url?: string | null;
  user_name?: string | null;
  photo_url?: string | null;
  updated_at?: string | null;
};

export type InsertionOrderPayload = {
  customer_name: string;
  customer_organization_id?: number | null;
  create_customer_if_missing?: boolean;
  counterparty_reference?: string;
  external_reference?: string;
  issue_date?: string;
  effective_date?: string;
  due_date?: string;
  start_date?: string;
  end_date?: string;
  status?: string;
  currency?: string;
  subtotal_amount?: number | null;
  tax_amount?: number | null;
  total_amount?: number | null;
  notes?: string;
};

type InsertionOrdersResponse = {
  results: InsertionOrder[];
  range_start: number;
  range_end: number;
  total_count: number;
  total_pages: number;
  page: number;
  page_size: number;
};

const DEFAULT_ERROR = "Something went wrong while loading insertion orders";

function toApiErrorMessage(body: unknown, fallback: string) {
  if (body && typeof body === "object") {
    const detail = "detail" in body ? body.detail : undefined;
    const message = "message" in body ? body.message : undefined;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

async function fetchInsertionOrders(
  page: number,
  pageSize: number,
  searchTerm: string,
  statusFilter: string,
): Promise<InsertionOrdersResponse> {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });

  if (searchTerm.trim()) {
    params.set("search", searchTerm.trim());
  }

  if (statusFilter !== "all") {
    params.set("status", statusFilter);
  }

  const res = await apiFetch(`/finance/insertion-orders?${params.toString()}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(toApiErrorMessage(body, `Failed with ${res.status}`));
  }
  return res.json();
}

async function createInsertionOrder(payload: InsertionOrderPayload): Promise<InsertionOrder> {
  const res = await apiFetch("/finance/insertion-orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(toApiErrorMessage(body, `Failed with ${res.status}`));
  }

  return res.json();
}

async function updateInsertionOrder(id: number, payload: InsertionOrderPayload): Promise<InsertionOrder> {
  const res = await apiFetch(`/finance/insertion-orders/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(toApiErrorMessage(body, `Failed with ${res.status}`));
  }

  return res.json();
}

async function deleteInsertionOrder(id: number): Promise<void> {
  const res = await apiFetch(`/finance/insertion-orders/${id}`, {
    method: "DELETE",
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(toApiErrorMessage(body, `Failed with ${res.status}`));
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return DEFAULT_ERROR;
}

export function useInsertionOrders(initialPage = 1, initialPageSize = 10) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [searchTerm, setSearchTermState] = useState("");
  const [statusFilter, setStatusFilterState] = useState("all");

  const deferredSearchTerm = useDeferredValue(searchTerm.trim());
  const deferredStatusFilter = useDeferredValue(statusFilter);

  const query = useQuery<InsertionOrdersResponse>({
    queryKey: ["insertion-orders", page, pageSize, deferredSearchTerm, deferredStatusFilter],
    queryFn: () => fetchInsertionOrders(page, pageSize, deferredSearchTerm, deferredStatusFilter),
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
  });

  const createMutation = useMutation({
    mutationFn: createInsertionOrder,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["insertion-orders"] }),
        queryClient.refetchQueries({ queryKey: ["insertion-orders"], type: "active" }),
        queryClient.invalidateQueries({ queryKey: ["sales-organizations"] }),
      ]);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: InsertionOrderPayload }) => updateInsertionOrder(id, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["insertion-orders"] }),
        queryClient.refetchQueries({ queryKey: ["insertion-orders"], type: "active" }),
        queryClient.invalidateQueries({ queryKey: ["sales-organizations"] }),
      ]);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteInsertionOrder,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["insertion-orders"] }),
        queryClient.refetchQueries({ queryKey: ["insertion-orders"], type: "active" }),
      ]);
    },
  });

  return {
    orders: query.data?.results ?? [],
    page: query.data?.page ?? page,
    pageSize,
    totalPages: query.data?.total_pages ?? 1,
    totalCount: query.data?.total_count ?? 0,
    rangeStart: query.data?.range_start ?? 0,
    rangeEnd: query.data?.range_end ?? 0,
    isLoading: query.isLoading || query.isFetching,
    error: query.error ? getErrorMessage(query.error) : null,
    searchTerm,
    statusFilter,
    goToPage: (nextPage: number) => setPage(Math.max(1, nextPage)),
    onPageSizeChange: (size: number) => {
      setPage(1);
      setPageSize(Math.max(1, size));
    },
    refresh: () => query.refetch(),
    setSearchTerm: (value: string) => {
      setPage(1);
      setSearchTermState(value);
    },
    setStatusFilter: (value: string) => {
      setPage(1);
      setStatusFilterState(value);
    },
    createOrder: (payload: InsertionOrderPayload) => createMutation.mutateAsync(payload),
    updateOrder: (id: number, payload: InsertionOrderPayload) => updateMutation.mutateAsync({ id, payload }),
    deleteOrder: (id: number) => deleteMutation.mutateAsync(id),
    isSaving: createMutation.isPending || updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
