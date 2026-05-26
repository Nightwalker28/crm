"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Bell,
  CalendarDays,
  ClipboardList,
  FileText,
  LayoutGrid,
  Mail,
  Plus,
  Settings2,
} from "lucide-react";

import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useNotifications } from "@/hooks/useNotifications";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { getModuleDisplayName } from "@/lib/module-display";
import { SETTINGS_ROUTES } from "@/lib/routes";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";

type ActivityItem = {
  id: number;
  module_key: string;
  entity_type: string;
  entity_id: string;
  action: string;
  description?: string | null;
  created_at: string;
};

type ActivityResponse = {
  results: ActivityItem[];
  total_count: number;
};

type CrmBucket = {
  key: string;
  label: string;
  count: number;
  value: number;
};

type OwnerPerformance = {
  owner_id?: number | null;
  owner_name: string;
  lead_count: number;
  deal_count: number;
  won_deal_count: number;
  quote_count: number;
  total_activity: number;
};

type CrmDashboardSummary = {
  period_days: number;
  lead_status: CrmBucket[];
  lead_sources: CrmBucket[];
  new_leads: number;
  deal_stages: CrmBucket[];
  pipeline_value: number;
  won_deals: number;
  lost_deals: number;
  quote_status: CrmBucket[];
  overdue_follow_ups: number;
  upcoming_tasks: number;
  owner_performance: OwnerPerformance[];
};

async function fetchDashboardActivity(): Promise<ActivityResponse> {
  const res = await apiFetch("/activity?page=1&page_size=6");
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to load recent activity.");
  }
  return body as ActivityResponse;
}

async function fetchCrmDashboardSummary(): Promise<CrmDashboardSummary> {
  const res = await apiFetch("/reports/crm-summary?period_days=30");
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to load CRM dashboard summary.");
  }
  return body as CrmDashboardSummary;
}

function getActionLabel(action: string) {
  return action.replace(/_/g, " ");
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function totalCount(rows: CrmBucket[]) {
  return rows.reduce((sum, row) => sum + row.count, 0);
}

function BucketList({ rows, emptyLabel }: { rows: CrmBucket[]; emptyLabel: string }) {
  const total = Math.max(totalCount(rows), 1);
  if (!rows.length) {
    return <div className="rounded-lg border border-dashed border-neutral-800 bg-black/20 px-4 py-5 text-sm text-neutral-500">{emptyLabel}</div>;
  }
  return (
    <div className="space-y-3">
      {rows.slice(0, 5).map((row) => (
        <div key={row.key}>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate text-neutral-300">{row.label}</span>
            <span className="font-medium text-neutral-100">{row.count}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-neutral-900">
            <div className="h-1.5 rounded-full bg-emerald-400/70" style={{ width: `${Math.max(6, (row.count / total) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function DashboardHomePage() {
  const { modules, isLoading: isModulesLoading } = useAccessibleModules();
  const {
    notifications,
    unreadCount,
    isLoading: isNotificationsLoading,
  } = useNotifications();
  const activityQuery = useQuery({
    queryKey: ["dashboard-home-activity"],
    queryFn: fetchDashboardActivity,
    staleTime: 30000,
  });
  const crmSummaryQuery = useQuery({
    queryKey: ["dashboard-crm-summary"],
    queryFn: fetchCrmDashboardSummary,
    staleTime: 30000,
  });
  const accessibleRoutes = useMemo(
    () => new Set(modules.map((module) => module.base_route).filter(Boolean)),
    [modules],
  );

  const quickActions = useMemo(() => {
    const actions = [
      { href: "/dashboard/tasks", label: "Tasks", helper: "Open assigned and team work queues" },
      { href: "/dashboard/calendar", label: "Calendar", helper: "Schedule internal events and review invites" },
      { href: "/dashboard/mail", label: "Mail", helper: "Open connected mailbox and CRM communication history" },
      { href: "/dashboard/documents", label: "Documents", helper: "Review uploaded and record-linked documents" },
      { href: "/dashboard/sales/contacts", label: "Contacts", helper: "Open the CRM contact list" },
      { href: "/dashboard/sales/organizations", label: "Accounts", helper: "Open account records" },
      { href: "/dashboard/sales/opportunities", label: "Deals", helper: "Review and update pipeline" },
      { href: "/dashboard/sales/quotes", label: "Quotes", helper: "Review CRM quote status and follow-up" },
    ];
    return actions.filter((action) => accessibleRoutes.has(action.href));
  }, [accessibleRoutes]);

  const stats = useMemo(
    () => [
      {
        label: "Accessible modules",
        value: isModulesLoading ? "..." : String(modules.length),
        helper: "Enabled and available from your current access scope",
      },
      {
        label: "Unread notifications",
        value: isNotificationsLoading ? "..." : String(unreadCount),
        helper: "Background jobs and operational events needing attention",
      },
      {
        label: "Recent activity items",
        value: activityQuery.isLoading ? "..." : String(activityQuery.data?.results.length ?? 0),
        helper: "Latest platform writes visible in the audit stream",
      },
      {
        label: "Quick actions",
        value: isModulesLoading ? "..." : String(quickActions.length),
        helper: "Fast entry points into the most common operational flows",
      },
    ],
    [
      activityQuery.data?.results.length,
      activityQuery.isLoading,
      isModulesLoading,
      isNotificationsLoading,
      modules.length,
      quickActions.length,
      unreadCount,
    ],
  );

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <PageHeader
        title="Dashboard"
        description="A shared home for system health, recent changes, and your fastest paths into the current modules."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={SETTINGS_ROUTES.activityLog}>
                <ClipboardList className="h-4 w-4" />
                Activity Log
              </Link>
            </Button>
            {accessibleRoutes.has("/dashboard/tasks") ? (
              <Button asChild>
                <Link href="/dashboard/tasks">
                  <Plus className="h-4 w-4" />
                  New Work
                </Link>
              </Button>
            ) : null}
            {accessibleRoutes.has("/dashboard/calendar") ? (
              <Button asChild variant="outline">
                <Link href="/dashboard/calendar">
                  <CalendarDays className="h-4 w-4" />
                  Calendar
                </Link>
              </Button>
            ) : null}
            {accessibleRoutes.has("/dashboard/mail") ? (
              <Button asChild variant="outline">
                <Link href="/dashboard/mail">
                  <Mail className="h-4 w-4" />
                  Mail
                </Link>
              </Button>
            ) : null}
            {accessibleRoutes.has("/dashboard/documents") ? (
              <Button asChild variant="outline">
                <Link href="/dashboard/documents">
                  <FileText className="h-4 w-4" />
                  Documents
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <section className="rounded-xl border border-neutral-800 bg-neutral-950/60">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-neutral-100">CRM Snapshot</h2>
            <p className="mt-1 text-sm text-neutral-400">
              Sales lifecycle health for leads, deals, quotes, and follow-up tasks.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/reports">Open Reports</Link>
          </Button>
        </div>

        {crmSummaryQuery.isLoading ? (
          <div className="px-5 py-8 text-sm text-neutral-500">Loading CRM summary...</div>
        ) : crmSummaryQuery.error ? (
          <div className="px-5 py-8 text-sm text-red-300">
            {crmSummaryQuery.error instanceof Error ? crmSummaryQuery.error.message : "Failed to load CRM summary."}
          </div>
        ) : crmSummaryQuery.data ? (
          <div className="grid gap-4 p-5 xl:grid-cols-4">
            <div className="rounded-lg border border-neutral-800 bg-black/20 px-4 py-4">
              <div className="text-xs uppercase tracking-[0.16em] text-neutral-500">New Leads</div>
              <div className="mt-3 text-3xl font-semibold text-neutral-100">{crmSummaryQuery.data.new_leads}</div>
              <div className="mt-1 text-sm text-neutral-400">Last {crmSummaryQuery.data.period_days} days</div>
            </div>
            <div className="rounded-lg border border-neutral-800 bg-black/20 px-4 py-4">
              <div className="text-xs uppercase tracking-[0.16em] text-neutral-500">Pipeline Value</div>
              <div className="mt-3 text-3xl font-semibold text-neutral-100">{formatCurrency(crmSummaryQuery.data.pipeline_value)}</div>
              <div className="mt-1 text-sm text-neutral-400">Open deal stages</div>
            </div>
            <div className="rounded-lg border border-neutral-800 bg-black/20 px-4 py-4">
              <div className="text-xs uppercase tracking-[0.16em] text-neutral-500">Won / Lost</div>
              <div className="mt-3 text-3xl font-semibold text-neutral-100">{crmSummaryQuery.data.won_deals} / {crmSummaryQuery.data.lost_deals}</div>
              <div className="mt-1 text-sm text-neutral-400">Closed deal outcomes</div>
            </div>
            <div className="rounded-lg border border-neutral-800 bg-black/20 px-4 py-4">
              <div className="text-xs uppercase tracking-[0.16em] text-neutral-500">Follow-ups</div>
              <div className="mt-3 text-3xl font-semibold text-neutral-100">{crmSummaryQuery.data.overdue_follow_ups}</div>
              <div className="mt-1 text-sm text-neutral-400">{crmSummaryQuery.data.upcoming_tasks} upcoming this week</div>
            </div>

            <div className="rounded-lg border border-neutral-800 bg-black/20 px-4 py-4 xl:col-span-2">
              <h3 className="text-sm font-semibold text-neutral-100">Leads By Status</h3>
              <div className="mt-4">
                <BucketList rows={crmSummaryQuery.data.lead_status} emptyLabel="No lead status data yet." />
              </div>
            </div>
            <div className="rounded-lg border border-neutral-800 bg-black/20 px-4 py-4 xl:col-span-2">
              <h3 className="text-sm font-semibold text-neutral-100">Deals By Stage</h3>
              <div className="mt-4">
                <BucketList rows={crmSummaryQuery.data.deal_stages} emptyLabel="No deal stage data yet." />
              </div>
            </div>
            <div className="rounded-lg border border-neutral-800 bg-black/20 px-4 py-4 xl:col-span-2">
              <h3 className="text-sm font-semibold text-neutral-100">Quotes By Status</h3>
              <div className="mt-4">
                <BucketList rows={crmSummaryQuery.data.quote_status} emptyLabel="No quote status data yet." />
              </div>
            </div>
            <div className="rounded-lg border border-neutral-800 bg-black/20 px-4 py-4 xl:col-span-2">
              <h3 className="text-sm font-semibold text-neutral-100">Owner Performance</h3>
              <div className="mt-4 space-y-3">
                {crmSummaryQuery.data.owner_performance.length ? crmSummaryQuery.data.owner_performance.slice(0, 5).map((owner) => (
                  <div key={`${owner.owner_id ?? "unassigned"}-${owner.owner_name}`} className="flex items-center justify-between gap-3 rounded-md border border-neutral-800 bg-neutral-950/60 px-3 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-neutral-100">{owner.owner_name}</div>
                      <div className="mt-1 text-xs text-neutral-500">{owner.lead_count} leads / {owner.deal_count} deals / {owner.quote_count} quotes</div>
                    </div>
                    <div className="text-sm font-semibold text-emerald-300">{owner.won_deal_count} won</div>
                  </div>
                )) : (
                  <div className="rounded-lg border border-dashed border-neutral-800 bg-black/20 px-4 py-5 text-sm text-neutral-500">No owner activity yet.</div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((item) => (
          <div
            key={item.label}
            className="rounded-xl border border-neutral-800 bg-neutral-950/60 px-5 py-5"
          >
            <div className="text-xs uppercase tracking-[0.18em] text-neutral-500">{item.label}</div>
            <div className="mt-3 text-3xl font-semibold leading-none text-neutral-100">{item.value}</div>
            <div className="mt-2 text-sm leading-6 text-neutral-400">{item.helper}</div>
          </div>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/60">
          <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-neutral-100">Module Entry Points</h2>
              <p className="mt-1 text-sm text-neutral-400">
                Open the modules you can reach from one consistent landing page instead of getting redirected away.
              </p>
            </div>
            <LayoutGrid className="h-4 w-4 text-neutral-500" />
          </div>

          {isModulesLoading ? (
            <div className="px-5 py-8 text-sm text-neutral-500">Loading module access…</div>
          ) : modules.length ? (
            <div className="grid gap-3 p-4 md:grid-cols-2">
              {modules.map((module) => (
                <Link
                  key={module.id}
                  href={module.base_route || "/dashboard/profile"}
                  className="group rounded-lg border border-neutral-800 bg-black/20 px-4 py-4 transition-colors hover:border-neutral-700 hover:bg-neutral-900/60"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-neutral-100">
                        {getModuleDisplayName(module.name, module.description ?? undefined)}
                      </div>
                      <div className="mt-1 text-sm leading-6 text-neutral-400">
                        {module.description || "Open this module and continue where your role allows."}
                      </div>
                    </div>
                    <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-neutral-600 transition-transform group-hover:translate-x-0.5 group-hover:text-neutral-300" />
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="px-5 py-8 text-sm text-neutral-500">
              No operational modules are currently available. Profile remains the fallback entry point.
            </div>
          )}
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-950/60">
          <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-neutral-100">Quick Actions</h2>
              <p className="mt-1 text-sm text-neutral-400">
                High-frequency starting points for current CRM workflows.
              </p>
            </div>
            <Settings2 className="h-4 w-4 text-neutral-500" />
          </div>

          <div className="space-y-3 p-4">
            {quickActions.length ? (
              quickActions.map((action) => (
                <Link
                  key={action.href}
                  href={action.href}
                  className="block rounded-lg border border-neutral-800 bg-black/20 px-4 py-4 transition-colors hover:border-neutral-700 hover:bg-neutral-900/60"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-neutral-100">{action.label}</div>
                      <div className="mt-1 text-sm text-neutral-400">{action.helper}</div>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-neutral-600" />
                  </div>
                </Link>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-neutral-800 bg-black/20 px-4 py-6 text-sm text-neutral-500">
                No quick actions are available until at least one main operational module is enabled for your account.
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/60">
          <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-neutral-100">Recent Activity</h2>
              <p className="mt-1 text-sm text-neutral-400">
                Latest audited writes across the platform, surfaced on the home screen instead of buried in admin.
              </p>
            </div>
            <ClipboardList className="h-4 w-4 text-neutral-500" />
          </div>

          {activityQuery.isLoading ? (
            <div className="px-5 py-8 text-sm text-neutral-500">Loading activity…</div>
          ) : activityQuery.data?.results.length ? (
            <div className="divide-y divide-neutral-800">
              {activityQuery.data.results.map((item) => (
                <div key={item.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-neutral-300">
                      {getActionLabel(item.action)}
                    </span>
                    <span className="text-sm font-medium text-neutral-100">
                      {getModuleDisplayName(item.module_key)}
                    </span>
                    <span className="text-xs text-neutral-500">
                      {item.entity_type} #{item.entity_id}
                    </span>
                  </div>
                  <div className="mt-2 text-sm text-neutral-300">
                    {item.description || `${item.entity_type} ${item.entity_id}`}
                  </div>
                  <div className="mt-1 text-xs text-neutral-500">{formatDateTime(item.created_at)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-5 py-8 text-sm text-neutral-500">
              No recent activity is available yet.
            </div>
          )}
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-950/60">
          <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-neutral-100">Notifications</h2>
              <p className="mt-1 text-sm text-neutral-400">
                Recent per-user updates from tasks, imports, exports, and background work.
              </p>
            </div>
            <Bell className="h-4 w-4 text-neutral-500" />
          </div>

          {isNotificationsLoading ? (
            <div className="px-5 py-8 text-sm text-neutral-500">Loading notifications…</div>
          ) : notifications.length ? (
            <div className="divide-y divide-neutral-800">
              {notifications.slice(0, 6).map((notification) => (
                <Link
                  key={notification.id}
                  href={notification.link_url || SETTINGS_ROUTES.activityLog}
                  className="block px-5 py-4 transition-colors hover:bg-neutral-900/50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-neutral-100">{notification.title}</div>
                      <div className="mt-1 text-sm leading-6 text-neutral-400">{notification.message}</div>
                      <div className="mt-2 text-xs text-neutral-500">{formatDateTime(notification.created_at)}</div>
                    </div>
                    {notification.read_at ? null : (
                      <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400" />
                    )}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="px-5 py-8 text-sm text-neutral-500">
              No notifications yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
