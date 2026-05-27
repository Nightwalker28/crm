"use client";

import { apiFetch } from "@/lib/api";
import { appendSavedViewFilterParams } from "@/lib/savedViewQuery";
import type { SavedViewFilters } from "@/hooks/useSavedViews";
import { usePagedList } from "@/hooks/usePagedList";

export type OrderItem = {
  id: number;
  order_id: number;
  name: string;
  description: string | null;
  quantity: string | number;
  unit_price: string | number;
  discount_amount: string | number;
  tax_amount: string | number;
  line_total: string | number;
  sort_order: number;
};

export type Order = {
  id: number;
  order_number: string;
  quote_id: number | null;
  organization_id: number | null;
  contact_id: number | null;
  opportunity_id: number | null;
  status: string;
  currency: string;
  subtotal?: string | number | null;
  tax_total?: string | number | null;
  discount_total?: string | number | null;
  grand_total: string | number;
  owner_id: number | null;
  created_by_id?: number | null;
  created_at: string;
  updated_at: string;
  items?: OrderItem[];
};

export type OrdersResponse = {
  results: Order[];
  range_start: number;
  range_end: number;
  total_count: number;
  total_pages: number;
  page: number;
};

async function fetchOrders(page: number, pageSize: number, _visibleColumns: string[], filters: SavedViewFilters): Promise<OrdersResponse> {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  appendSavedViewFilterParams(params, filters);
  const searchTerm = typeof filters.search === "string" ? filters.search.trim() : "";
  const path = searchTerm ? `/sales/orders/search?${params.toString()}` : `/sales/orders?${params.toString()}`;
  const res = await apiFetch(path);
  if (!res.ok) throw new Error(`Failed with ${res.status}`);
  return res.json();
}

export function useOrders(visibleColumns: string[], viewFilters: SavedViewFilters, initialPage = 1, initialPageSize = 10) {
  const paged = usePagedList<Order, OrdersResponse>({
    queryKey: ["sales-orders"],
    fetcher: (page, pageSize, filters, columns) => fetchOrders(page, pageSize, columns, filters),
    visibleColumns,
    filters: viewFilters,
    initialPage,
    initialPageSize,
    errorMessage: () => "Failed to load orders",
  });

  return {
    orders: paged.items,
    page: paged.page,
    totalPages: paged.totalPages,
    totalCount: paged.totalCount,
    rangeStart: paged.rangeStart,
    rangeEnd: paged.rangeEnd,
    pageSize: paged.pageSize,
    isLoading: paged.isLoading,
    isFetching: paged.isFetching,
    error: paged.error,
    goToPage: paged.goToPage,
    onPageSizeChange: paged.onPageSizeChange,
    refresh: paged.refresh,
  };
}
