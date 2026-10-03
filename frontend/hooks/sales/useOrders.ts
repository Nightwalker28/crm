"use client";

import { useQuery } from "@tanstack/react-query";

import { ApiError, apiFetch } from "@/lib/api";
import { appendSavedViewFilterParams } from "@/lib/savedViewQuery";
import type { SavedViewFilters } from "@/hooks/useSavedViews";
import { usePagedList, type PagedListSort } from "@/hooks/usePagedList";

export type OrderItem = {
  id: number;
  order_id: number;
  catalog_product_id?: number | null;
  catalog_service_id?: number | null;
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
  quote_number?: string | null;
  organization_id: number | null;
  contact_id: number | null;
  opportunity_id: number | null;
  organization_name?: string | null;
  contact_name?: string | null;
  opportunity_name?: string | null;
  status: string;
  currency: string;
  exchange_rate?: string | null;
  base_currency?: string | null;
  suggested_exchange_rate?: string | null;
  subtotal?: string | number | null;
  tax_total?: string | number | null;
  discount_total?: string | number | null;
  grand_total: string | number;
  owner_id: number | null;
  owner_name?: string | null;
  /** Where the order's stock is held and shipped from. */
  warehouse_id?: number | null;
  warehouse_name?: string | null;
  /** none · pending · partial · delivered · closed, from the order's deliveries. */
  delivery_status?: string;
  /** E5: none · pending · to_invoice · partial · invoiced (12c §3.2). */
  invoice_status?: string;
  /** urgent · high · normal: arriving stock goes to waiting orders in this order, then oldest first. */
  priority?: string;
  remaining_closed_at?: string | null;
  remaining_close_reason?: string | null;
  delivery_date?: string | null;
  delivery_address?: string | null;
  payment_terms?: string | null;
  notes?: string | null;
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

export type OrderSortState = PagedListSort;

async function fetchOrders(
  page: number,
  pageSize: number,
  filters: SavedViewFilters,
  _visibleColumns: string[],
  sort: OrderSortState,
): Promise<OrdersResponse> {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (sort) {
    params.set("sort_by", sort.key);
    params.set("sort_direction", sort.direction);
  }
  appendSavedViewFilterParams(params, filters);
  const searchTerm = typeof filters.search === "string" ? filters.search.trim() : "";
  const path = searchTerm ? `/sales/orders/search?${params.toString()}` : `/sales/orders?${params.toString()}`;
  const res = await apiFetch(path);
  if (!res.ok) throw new Error(`Failed with ${res.status}`);
  return res.json();
}

export function useOrders(
  visibleColumns: string[],
  viewFilters: SavedViewFilters,
  sort: OrderSortState = null,
  initialPage = 1,
  initialPageSize = 10,
) {
  const paged = usePagedList<Order, OrdersResponse>({
    queryKey: ["sales-orders"],
    fetcher: fetchOrders,
    visibleColumns,
    filters: viewFilters,
    sort,
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

// --- Margin (ERP E6, 12d-erp-costing.md §3.3) ----------------------------------------------

export type OrderMarginLine = {
  order_line_id: number; name: string; quantity: string; tracked: boolean; delivered: string; estimated_quantity: string;
  revenue: string | null; cost: string; margin: string | null; margin_percent: string | null;
  actual_revenue: string | null; actual_cost: string; estimated: boolean; cost_missing: boolean;
};
export type OrderMargin = {
  order_id: number; currency: string; base_currency: string; exchange_rate: string | null; rate_missing: boolean;
  estimated: boolean; cost_missing: boolean; revenue: string | null; cost: string; margin: string | null; margin_percent: string | null;
  actual_revenue: string | null; actual_cost: string; actual_margin: string | null; lines: OrderMarginLine[];
};

export function useOrderMargin(orderId: number | null, enabled = true) {
  return useQuery({
    // Under the fulfilment key, so a delivery, return or receipt refreshes it too.
    queryKey: ["sales-order-fulfilment", "margin", orderId],
    queryFn: async () => {
      const response = await apiFetch(`/sales/orders/${orderId}/margin`);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
        throw new ApiError(response.status, typeof body?.detail === "string" ? body.detail : "Margin could not be loaded.");
      }
      return response.json() as Promise<OrderMargin>;
    },
    enabled: orderId !== null && enabled,
  });
}
