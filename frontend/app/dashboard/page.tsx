"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Bell,
  CalendarDays,
  ClipboardList,
  LayoutGrid,
  Plus,
  Settings2,
} from "lucide-react";

import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useNotifications } from "@/hooks/useNotifications";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
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

async function fetchDashboardActivity(): Promise<ActivityResponse> {
  const res = await apiFetch("/activity?page=1&page_size=6");
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to load recent activity.");
  }
  return body as ActivityResponse;
}

function getModuleLabel(moduleKey: string) {
  return moduleKey
    .replace(/_/g, " ")
    .replace(/\b\w/g, (value) => value.toUpperCase());
}

function getActionLabel(action: string) {
  return action.replace(/_/g, " ");
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

  const quickActions = useMemo(() => {
    const actions = [
      { href: "/dashboard/tasks", label: "Tasks", helper: "Open assigned and team work queues" },
      { href: "/dashboard/calendar", label: "Calendar", helper: "Schedule internal events and review invites" },
      { href: "/dashboard/sales/contacts", label: "Contacts", helper: "Open the CRM contact list" },
      { href: "/dashboard/sales/organizations", label: "Organizations", helper: "Open account records" },
      { href: "/dashboard/sales/opportunities", label: "Opportunities", helper: "Review and update pipeline" },
      { href: "/dashboard/finance/insertion-orders", label: "Insertion Orders", helper: "Manage finance handoff and IOs" },
    ];
    const accessibleRoutes = new Set(modules.map((module) => module.base_route).filter(Boolean));
    return actions.filter((action) => accessibleRoutes.has(action.href));
  }, [modules]);

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
              <Link href="/dashboard/activity-log">
                <ClipboardList className="h-4 w-4" />
                Activity Log
              </Link>
            </Button>
            <Button asChild>
              <Link href="/dashboard/tasks">
                <Plus className="h-4 w-4" />
                New Work
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/dashboard/calendar">
                <CalendarDays className="h-4 w-4" />
                Calendar
              </Link>
            </Button>
          </>
        }
      />

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
                      <div className="text-sm font-semibold text-neutral-100">{module.name}</div>
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
                High-frequency starting points for the current CRM and finance workflows.
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
                      {getModuleLabel(item.module_key)}
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
                  href={notification.link_url || "/dashboard/activity-log"}
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
