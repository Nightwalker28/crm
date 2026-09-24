"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, BellRing, CheckCheck, Loader2 } from "lucide-react";

import { useNotifications } from "@/hooks/useNotifications";
import { useSidebarUser } from "@/hooks/useSidebarUser";
import { Button } from "@/components/ui/button";
import { ListRow, RowList } from "@/components/ui/ListRow";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/ui/PanelStates";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDateTime } from "@/lib/datetime";
import { SETTINGS_ROUTES, resolveNotificationHref } from "@/lib/routes";

export default function NotificationCenter() {
  const {
    notifications,
    unreadCount,
    isLoading,
    isFetching,
    isError,
    refetch,
    markRead,
    markAllRead,
    isMarkingAllRead,
  } = useNotifications();
  // A9: `View all activity` points at an admin-only settings route. Offering it to a
  // non-admin is offering a permission wall.
  const { isAdmin } = useSidebarUser();
  const [actionError, setActionError] = useState<string | null>(null);
  const [browserPermission, setBrowserPermission] = useState<NotificationPermission | "unsupported">(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return "unsupported";
    }
    return Notification.permission;
  });

  async function handleNotificationClick(notificationId: number) {
    try {
      setActionError(null);
      await markRead(notificationId);
    } catch {
      // keep navigation usable even if the read mutation fails
    }
  }

  async function handleEnableBrowserNotifications() {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const permission = await Notification.requestPermission();
    setBrowserPermission(permission);
  }

  async function handleMarkAllRead() {
    try {
      setActionError(null);
      await markAllRead();
    } catch {
      setActionError("Notifications could not be marked as read. Try again.");
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="relative"
          aria-label={unreadCount ? `Open notifications, ${unreadCount} unread` : "Open notifications"}
        >
          <Bell className="h-4 w-4" />
          {unreadCount ? (
            <span className="absolute -right-1 -top-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-primary px-0.5 text-2xs font-bold leading-none text-primary-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={10}
        className="w-[min(380px,calc(100vw-2rem))] border-line-default bg-surface-raised p-0 text-copy-primary shadow-[var(--shadow-panel)]"
      >
        <div className="space-y-3 border-b border-line-default px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-copy-primary">Notifications</p>
            <p className="text-xs text-copy-muted">
              Task assignments and background jobs appear here first.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void handleMarkAllRead()}
              disabled={!unreadCount || isMarkingAllRead}
            >
              {isMarkingAllRead ? <Loader2 className="animate-spin" /> : <CheckCheck />}
              Mark all read
            </Button>
            {browserPermission === "default" ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void handleEnableBrowserNotifications()}
              >
                <BellRing />
                Enable browser alerts
              </Button>
            ) : null}
          </div>
          {browserPermission === "denied" ? (
            <p className="text-xs text-copy-muted">Browser alerts are blocked. You can re-enable them in your browser settings.</p>
          ) : null}
          {actionError ? <p role="alert" className="text-xs text-state-danger">{actionError}</p> : null}
        </div>

        <div className="max-h-[420px] overflow-y-auto custom-scrollbar">
          {isLoading ? (
            <PanelLoading label="Loading notifications…" />
          ) : isError ? (
            <div className="p-4">
              <PanelError message="Notifications could not be loaded." onRetry={() => void refetch()} />
            </div>
          ) : notifications.length ? (
            // Unread was the primary action's tint on the whole row plus a filled dot — the
            // fourth instance of the action tint carrying a state. It is weight and a dot in
            // ink (§7.15).
            <RowList inset label="Notifications">
              {notifications.map((notification) => {
                const unread = notification.status === "unread";
                const time = formatDateTime(notification.created_at, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                });
                return (
                  <ListRow
                    key={notification.id}
                    title={notification.title}
                    unread={unread}
                    trailing={<time dateTime={notification.created_at}>{time}</time>}
                    {...(notification.link_url
                      ? {
                          href: resolveNotificationHref(notification.link_url),
                          onNavigate: () => void handleNotificationClick(notification.id),
                        }
                      : { onSelect: () => void handleNotificationClick(notification.id) })}
                  >
                    {notification.message}
                  </ListRow>
                );
              })}
            </RowList>
          ) : (
            <PanelEmpty
              icon={Bell}
              title="No notifications yet"
              description="Task assignments and background jobs will start writing updates here."
            />
          )}
        </div>

        {isFetching && !isLoading ? (
          <div role="status" className="border-t border-line-default px-4 py-2 text-xs text-copy-muted">
            Refreshing…
          </div>
        ) : null}
        {isAdmin ? (
          <div className="border-t border-line-default px-4 py-3">
            <Link href={SETTINGS_ROUTES.activityLog} className="text-xs font-medium text-copy-secondary hover:text-copy-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
              View all activity
            </Link>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
