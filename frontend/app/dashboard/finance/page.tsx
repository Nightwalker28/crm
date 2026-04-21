"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, FileSpreadsheet, ReceiptText } from "lucide-react";

import { apiFetch } from "@/lib/api";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";

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
    return {
      total: summaryQuery.data?.total_count ?? 0,
      overdueCount,
      activeCount,
      draftCount,
    };
  }, [summaryQuery.data]);

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <PageHeader
        title="Finance"
        description="Finance entry point with live insertion-order context and direct access into operational workflows."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/dashboard/recycle-bin">Recycle Bin</Link>
            </Button>
            <Button asChild>
              <Link href="/dashboard/finance/insertion-orders">Open Insertion Orders</Link>
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
            <div className="text-xs uppercase tracking-[0.18em] text-neutral-500">Overdue in View</div>
            <AlertTriangle className="h-4 w-4 text-neutral-500" />
          </div>
          <div className="mt-3 text-3xl font-semibold text-neutral-100">{metrics.overdueCount}</div>
          <div className="mt-2 text-sm text-neutral-400">Recent loaded orders whose due date has already passed.</div>
        </div>
      </section>

      <section className="rounded-xl border border-neutral-800 bg-neutral-950/60">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-neutral-100">Recent Insertion Orders</h2>
            <p className="mt-1 text-sm text-neutral-400">Live finance records until deeper charts and trend views are added.</p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/finance/insertion-orders">
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
                href="/dashboard/finance/insertion-orders"
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
