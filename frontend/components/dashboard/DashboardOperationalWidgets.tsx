import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AccessibleModule } from "@/hooks/useAccessibleModules";
import type { UserNotification } from "@/hooks/useNotifications";
import { formatDateTime } from "@/lib/datetime";
import { getModuleDisplayName } from "@/lib/module-display";
import { getModuleRoute } from "@/lib/module-registry";
import { SETTINGS_ROUTES, resolveNotificationHref } from "@/lib/routes";

export type DashboardActivityItem = {
  id: number;
  module_key: string;
  entity_type: string;
  entity_id: string;
  action: string;
  description?: string | null;
  created_at: string;
};

export type DashboardQuickAction = {
  href: string;
  label: string;
  helper: string;
};

function actionLabel(action: string) {
  return action.replace(/_/g, " ");
}

export function DashboardEmptyMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-dashed border-line-default bg-surface-muted px-4 py-6 text-sm text-copy-muted">
      {children}
    </div>
  );
}

export function DashboardModuleEntryPoints({
  modules,
  isLoading,
}: {
  modules: AccessibleModule[];
  isLoading: boolean;
}) {
  if (isLoading) return <div className="text-sm text-copy-muted">Loading module access...</div>;
  if (!modules.length) {
    return <DashboardEmptyMessage>No operational modules are currently available.</DashboardEmptyMessage>;
  }
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {modules.map((module) => {
        const href = getModuleRoute(module.name, module.base_route) || "/dashboard/profile";
        return (
          <Link
            key={module.id}
            href={href}
            className="group rounded-[var(--radius-card)] border border-line-default bg-surface-muted px-4 py-4 transition-colors hover:border-line-strong hover:bg-surface-raised"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-copy-primary">
                  {getModuleDisplayName(module.name, module.description ?? undefined)}
                </div>
                <div className="mt-1 text-p-sm text-copy-secondary">
                  {module.description || "Open this module and continue where your role allows."}
                </div>
              </div>
              <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-copy-muted transition-transform group-hover:translate-x-0.5 group-hover:text-copy-primary" />
            </div>
          </Link>
        );
      })}
    </div>
  );
}

export function DashboardQuickActions({ actions }: { actions: DashboardQuickAction[] }) {
  if (!actions.length) {
    return <DashboardEmptyMessage>No quick actions are available until operational modules are enabled.</DashboardEmptyMessage>;
  }
  return (
    <div className="space-y-3">
      {actions.map((action) => (
        <Link
          key={action.href}
          href={action.href}
          className="block rounded-[var(--radius-card)] border border-line-default bg-surface-muted px-4 py-4 transition-colors hover:border-line-strong hover:bg-surface-raised"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-copy-primary">{action.label}</div>
              <div className="mt-1 text-sm text-copy-secondary">{action.helper}</div>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-copy-muted" />
          </div>
        </Link>
      ))}
    </div>
  );
}

export function DashboardRecentActivity({
  items,
  isLoading,
  isError,
  onRetry,
}: {
  items: DashboardActivityItem[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  if (isLoading) return <div className="text-sm text-copy-muted">Loading activity...</div>;
  if (isError) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-state-danger/30 bg-state-danger-muted p-3 text-sm text-copy-secondary">
        <span>Recent activity could not be loaded.</span>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>Retry</Button>
      </div>
    );
  }
  if (!items.length) return <DashboardEmptyMessage>No recent activity is available yet.</DashboardEmptyMessage>;
  return (
    <div className="divide-y divide-line-subtle rounded-[var(--radius-card)] border border-line-default">
      {items.map((item) => (
        <div key={item.id} className="px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-line-default bg-surface-raised px-2 py-1 text-2xs font-medium text-copy-secondary">
              {actionLabel(item.action)}
            </span>
            <span className="text-sm font-medium text-copy-primary">{getModuleDisplayName(item.module_key)}</span>
            <span className="text-xs text-copy-muted">{item.entity_type} #{item.entity_id}</span>
          </div>
          <div className="mt-2 text-sm text-copy-secondary">{item.description || `${item.entity_type} ${item.entity_id}`}</div>
          <div className="mt-1 text-xs text-copy-muted">{formatDateTime(item.created_at)}</div>
        </div>
      ))}
    </div>
  );
}

export function DashboardNotifications({
  notifications,
  isLoading,
  isError,
  onRetry,
  onRead,
}: {
  notifications: UserNotification[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onRead: (notificationId: number) => void;
}) {
  if (isLoading) return <div className="text-sm text-copy-muted">Loading notifications...</div>;
  if (isError) {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-4 text-sm text-copy-primary">
        <span>Notifications could not be loaded.</span>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>Try again</Button>
      </div>
    );
  }
  if (!notifications.length) return <DashboardEmptyMessage>No notifications yet.</DashboardEmptyMessage>;
  return (
    <div className="divide-y divide-line-subtle rounded-[var(--radius-card)] border border-line-default">
      {notifications.slice(0, 6).map((notification) => (
        <Link
          key={notification.id}
          href={resolveNotificationHref(notification.link_url, SETTINGS_ROUTES.activityLog)}
          onClick={() => onRead(notification.id)}
          className="block px-4 py-4 transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-copy-primary">{notification.title}</div>
              <div className="mt-1 text-p-sm text-copy-secondary">{notification.message}</div>
              <div className="mt-2 text-xs text-copy-muted">{formatDateTime(notification.created_at)}</div>
            </div>
            {notification.read_at ? null : <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-state-success" />}
          </div>
        </Link>
      ))}
    </div>
  );
}
