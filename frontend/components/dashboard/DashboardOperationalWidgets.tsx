import Link from "next/link";
import { ArrowRight, Bell, ClipboardList, LayoutGrid, Zap } from "lucide-react";

import { ListRow, RowList } from "@/components/ui/ListRow";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/ui/PanelStates";
import type { AccessibleModule } from "@/hooks/useAccessibleModules";
import type { UserNotification } from "@/hooks/useNotifications";
import { formatDateTime } from "@/lib/datetime";
import { getModuleDisplayName } from "@/lib/module-display";
import { getModuleRoute } from "@/lib/module-registry";
import { resolveNotificationHref } from "@/lib/routes";

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

export function DashboardModuleEntryPoints({
  modules,
  isLoading,
}: {
  modules: AccessibleModule[];
  isLoading: boolean;
}) {
  if (isLoading) return <PanelLoading label="Loading modules…" />;
  if (!modules.length) {
    return <PanelEmpty icon={LayoutGrid} title="No modules are available yet" description="Modules appear here once your role is given access to them." />;
  }
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {modules.map((module) => {
        const href = getModuleRoute(module.name, module.base_route) || "/dashboard/profile";
        return (
          <Link
            key={module.id}
            href={href}
            className="group rounded-[var(--radius-control)] border border-line-subtle px-4 py-4 transition-colors hover:border-line-strong hover:bg-surface-muted"
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
    return <PanelEmpty icon={Zap} title="No quick actions yet" description="Quick actions appear once the modules they open are enabled for your role." />;
  }
  return (
    <div className="space-y-3">
      {actions.map((action) => (
        <Link
          key={action.href}
          href={action.href}
          className="block rounded-[var(--radius-control)] border border-line-subtle px-4 py-4 transition-colors hover:border-line-strong hover:bg-surface-muted"
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
  if (isLoading) return <PanelLoading label="Loading activity…" />;
  if (isError) return <PanelError message="Recent activity could not be loaded." onRetry={onRetry} />;
  if (!items.length) return <PanelEmpty icon={ClipboardList} title="No recent activity yet" />;
  return (
    <RowList ordered label="Recent activity">
      {items.map((item) => (
        // The action was a bordered capsule — `Pill` under another name (R5). It is a word in
        // the row's metadata.
        <ListRow
          key={item.id}
          title={item.description || `${item.entity_type} ${item.entity_id}`}
          trailing={<time dateTime={item.created_at}>{formatDateTime(item.created_at)}</time>}
          meta={`${getModuleDisplayName(item.module_key)} · ${actionLabel(item.action)} · ${item.entity_type} #${item.entity_id}`}
        />
      ))}
    </RowList>
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
  if (isLoading) return <PanelLoading label="Loading notifications…" />;
  if (isError) return <PanelError message="Notifications could not be loaded." onRetry={onRetry} />;
  if (!notifications.length) return <PanelEmpty icon={Bell} title="No notifications yet" />;
  return (
    <RowList label="Notifications">
      {notifications.slice(0, 6).map((notification) => (
        // A9: the fallback was the admin-only activity log, on a widget every role sees. The
        // default lands on the dashboard instead. Unread is not success (R5): it is weight and
        // a dot in ink (§7.15).
        <ListRow
          key={notification.id}
          href={resolveNotificationHref(notification.link_url)}
          onNavigate={() => onRead(notification.id)}
          unread={!notification.read_at}
          title={notification.title}
          trailing={<time dateTime={notification.created_at}>{formatDateTime(notification.created_at)}</time>}
        >
          {notification.message}
        </ListRow>
      ))}
    </RowList>
  );
}
