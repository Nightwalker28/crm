"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, BellRing, CheckCheck, Loader2, RefreshCw } from "lucide-react";

import { useNotifications } from "@/hooks/useNotifications";
import { Button } from "@/components/ui/button";
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
            <span className="absolute -right-1 -top-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-bold leading-none text-primary-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={10}
        className="w-[min(380px,calc(100vw-2rem))] border-line-default bg-surface-raised p-0 text-copy-primary shadow-xl"
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
            <div role="status" className="flex min-h-40 items-center justify-center gap-2 text-sm text-copy-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading notifications…
            </div>
          ) : isError ? (
            <div role="alert" className="flex min-h-40 flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm font-medium text-copy-primary">Notifications could not be loaded.</p>
              <p className="text-xs leading-5 text-copy-muted">Check your connection and try again.</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
                <RefreshCw />
                Try again
              </Button>
            </div>
          ) : notifications.length ? (
            <div className="divide-y divide-line-subtle">
              {notifications.map((notification) => {
                const content = (
                  <div
                    className={
                      "space-y-1 px-4 py-3 transition-colors " +
                      (notification.status === "unread"
                        ? "bg-action-primary-muted"
                        : "bg-transparent") +
                      " hover:bg-surface-muted"
                    }
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2">
                        {notification.status === "unread" ? (
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />
                        ) : null}
                        <p className="text-sm font-medium text-copy-primary">{notification.title}</p>
                      </div>
                      <span className="shrink-0 text-[11px] text-copy-muted">
                        {formatDateTime(notification.created_at, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <p className="text-xs leading-5 text-copy-secondary">
                      {notification.message}
                    </p>
                  </div>
                );

                if (notification.link_url) {
                  return (
                    <Link
                      key={notification.id}
                      href={resolveNotificationHref(notification.link_url)}
                      onClick={() => void handleNotificationClick(notification.id)}
                      className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                    >
                      {content}
                    </Link>
                  );
                }

                return (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={() => void handleNotificationClick(notification.id)}
                    className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                  >
                    {content}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex min-h-40 flex-col items-center justify-center px-6 text-center">
              <Bell className="h-5 w-5 text-copy-disabled" />
              <p className="mt-3 text-sm font-medium text-copy-primary">No notifications yet</p>
              <p className="mt-1 text-xs leading-5 text-copy-muted">
                Task assignments and background jobs will start writing updates here.
              </p>
            </div>
          )}
        </div>

        {isFetching && !isLoading ? (
          <div role="status" className="border-t border-line-default px-4 py-2 text-[11px] text-copy-muted">
            Refreshing…
          </div>
        ) : null}
        <div className="border-t border-line-default px-4 py-3">
          <Link href={SETTINGS_ROUTES.activityLog} className="text-xs font-medium text-copy-secondary hover:text-copy-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            View all activity
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
