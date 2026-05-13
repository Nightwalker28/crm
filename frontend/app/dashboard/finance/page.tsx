"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, FileSpreadsheet, Plus, ReceiptText } from "lucide-react";

import { apiFetch } from "@/lib/api";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { DASHBOARD_ROUTES, SETTINGS_ROUTES } from "@/lib/routes";

type FinanceSummaryResponse = {
  total_count: number;
  results: Array<{
    id: number;
    io_number: string;
    customer_name: string;
    status: string;
    total_amount?: number | null;
    currency?: string | null;
    due_date?: string | null;
    updated_at?: string | null;
  }>;
};

async function fetchFinanceSummary(): Promise<FinanceSummaryResponse> {
  const res = await apiFetch("/finance/insertion-orders?page=1&page_size=8&fields=io_number,customer_name,status,total_amount,currency,due_date,updated_at");
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to load finance summary.");
  }
  return body as FinanceSummaryResponse;
}

function formatMoney(amount?: number | null, currency?: string | null) {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return String(amount);
  }
}

function isOverdue(order: FinanceSummaryResponse["results"][number]) {
  if (!order.due_date) return false;
  try {
    return new Date(order.due_date) < new Date() && order.status !== "completed" && order.status !== "cancelled";
  } catch {
    return false;
  }
}

export default function FinancePage() {
  const summaryQuery = useQuery({
    queryKey: ["finance-dashboard-summary"],
    queryFn: fetchFinanceSummary,
    staleTime: 30000,
  });

  const metrics = useMemo(() => {
    const orders = summaryQuery.data?.results ?? [];
    const overdueCount = orders.filter(isOverdue).length;
    const activeCount = orders.filter((order) => ["issued", "active"].includes(order.status)).length;
    const draftCount = orders.filter((order) => order.status === "draft").length;
    const now = new Date();
    const completedThisMonth = orders.filter((order) => {
      if (order.status !== "completed" || !order.updated_at) return false;
      const updatedAt = new Date(order.updated_at);
      return updatedAt.getFullYear() === now.getFullYear() && updatedAt.getMonth() === now.getMonth();
    }).length;
    return {
      total: summaryQuery.data?.total_count ?? 0,
      overdueCount,
      activeCount,
      draftCount,
      completedThisMonth,
    };
  }, [summaryQuery.data]);

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <PageHeader
        title="Finance"
        description="Monitor insertion orders, POS invoices, and finance activity."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={SETTINGS_ROUTES.recycleBin}>Recycle Bin</Link>
            </Button>
            <Button asChild>
              <Link href={DASHBOARD_ROUTES.insertionOrders}>Open Insertion Orders</Link>
            </Button>
            <Button asChild>
              <Link href={DASHBOARD_ROUTES.financePos}>Open POS Mode</Link>
            </Button>
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 px-5 py-5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs uppercase tracking-[0.18em] text-neutral-500">Insertion Orders</div>
            <ReceiptText className="h-4 w-4 text-neutral-500" />
          </div>
          <div className="mt-3 text-3xl font-semibold text-neutral-100">{metrics.total}</div>
          <div className="mt-2 text-sm text-neutral-400">Records currently in the finance workflow.</div>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 px-5 py-5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs uppercase tracking-[0.18em] text-neutral-500">Issued / Active</div>
            <FileSpreadsheet className="h-4 w-4 text-neutral-500" />
          </div>
          <div className="mt-3 text-3xl font-semibold text-neutral-100">{metrics.activeCount}</div>
          <div className="mt-2 text-sm text-neutral-400">Orders currently moving through commercial execution.</div>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 px-5 py-5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs uppercase tracking-[0.18em] text-neutral-500">Drafts</div>
            <ReceiptText className="h-4 w-4 text-neutral-500" />
          </div>
          <div className="mt-3 text-3xl font-semibold text-neutral-100">{metrics.draftCount}</div>
          <div className="mt-2 text-sm text-neutral-400">Orders not yet issued out of the draft state.</div>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 px-5 py-5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs uppercase tracking-[0.18em] text-neutral-500">Completed this month</div>
            <FileSpreadsheet className="h-4 w-4 text-neutral-500" />
          </div>
          <div className="mt-3 text-3xl font-semibold text-neutral-100">{metrics.completedThisMonth}</div>
          <div className="mt-2 text-sm text-neutral-400">Completed orders from the currently loaded finance summary.</div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <Link
          href={DASHBOARD_ROUTES.insertionOrders}
          className="group rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4 transition-colors hover:border-neutral-700 hover:bg-neutral-900/60"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-neutral-100">New Insertion Order</div>
              <div className="mt-1 text-sm text-neutral-500">Open insertion orders and create a finance record.</div>
            </div>
            <Plus className="h-4 w-4 text-neutral-500 group-hover:text-neutral-200" />
          </div>
        </Link>
        <Link
          href={DASHBOARD_ROUTES.financePos}
          className="group rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4 transition-colors hover:border-neutral-700 hover:bg-neutral-900/60"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-neutral-100">New POS Invoice</div>
              <div className="mt-1 text-sm text-neutral-500">Open POS mode and create an invoice.</div>
            </div>
            <Plus className="h-4 w-4 text-neutral-500 group-hover:text-neutral-200" />
          </div>
        </Link>
      </section>

      <section className="rounded-xl border border-neutral-800 bg-neutral-950/60">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-neutral-100">Recent Insertion Orders</h2>
            <p className="mt-1 text-sm text-neutral-400">Live finance records until deeper charts and trend views are added.</p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={DASHBOARD_ROUTES.insertionOrders}>
              View All
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>

        {summaryQuery.isLoading ? (
          <div className="px-5 py-8 text-sm text-neutral-500">Loading insertion orders…</div>
        ) : summaryQuery.data?.results.length ? (
          <div className="divide-y divide-neutral-800">
            {summaryQuery.data.results.map((order) => (
              <Link
                key={order.id}
                href={DASHBOARD_ROUTES.insertionOrders}
                className="block px-5 py-4 transition-colors hover:bg-neutral-900/50"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-neutral-300">
                        {order.status}
                      </span>
                      <span className="text-sm font-medium text-neutral-100">{order.io_number}</span>
                      <span className="text-sm text-neutral-400">{order.customer_name}</span>
                    </div>
                    <div className="mt-2 text-sm text-neutral-400">
                      Due {order.due_date ? formatDateOnly(order.due_date) : "not set"}{order.updated_at ? ` · updated ${formatDateTime(order.updated_at)}` : ""}
                    </div>
                  </div>
                  <div className={`text-sm font-semibold ${isOverdue(order) ? "text-red-400" : "text-emerald-300"}`}>
                    {formatMoney(order.total_amount, order.currency)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="px-5 py-8 text-sm text-neutral-500">No insertion orders yet.</div>
        )}
      </section>
    </div>
  );
}
