"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, BellRing, CheckCheck, Loader2 } from "lucide-react";

import { useNotifications } from "@/hooks/useNotifications";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDateTime } from "@/lib/datetime";

export default function NotificationCenter() {
  const { notifications, unreadCount, isLoading, isFetching, markRead, markAllRead } =
    useNotifications();
  const [browserPermission, setBrowserPermission] = useState<NotificationPermission | "unsupported">(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return "unsupported";
    }
    return Notification.permission;
  });

  async function handleNotificationClick(notificationId: number) {
    try {
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

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-white/8 hover:text-neutral-100"
          aria-label="Open notifications"
        >
          <Bell className="h-3.5 w-3.5" />
          {unreadCount ? (
            <span className="absolute -right-1 -top-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-white px-0.5 text-[9px] font-bold leading-none text-black">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        side="right"
        sideOffset={12}
        className="w-[360px] border-white/10 bg-neutral-950 p-0 text-neutral-100"
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-neutral-100">Notifications</p>
            <p className="text-xs text-neutral-400">
              Task assignments and background jobs appear here first.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-neutral-300 hover:bg-white/8 hover:text-white"
            onClick={() => void markAllRead()}
            disabled={!notifications.length}
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Mark all
          </Button>
          {browserPermission === "default" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-neutral-300 hover:bg-white/8 hover:text-white"
              onClick={() => void handleEnableBrowserNotifications()}
            >
              <BellRing className="h-3.5 w-3.5" />
              Enable alerts
            </Button>
          ) : null}
        </div>

        <div className="max-h-[420px] overflow-y-auto custom-scrollbar">
          {isLoading ? (
            <div className="flex min-h-40 items-center justify-center text-neutral-400">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : notifications.length ? (
            <div className="divide-y divide-white/8">
              {notifications.map((notification) => {
                const content = (
                  <div
                    className={
                      "space-y-1 px-4 py-3 transition-colors " +
                      (notification.status === "unread"
                        ? "bg-white/[0.03]"
                        : "bg-transparent") +
                      " hover:bg-white/[0.05]"
                    }
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium text-neutral-100">
                        {notification.title}
                      </p>
                      <span className="shrink-0 text-[11px] text-neutral-500">
                        {formatDateTime(notification.created_at, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <p className="text-xs leading-5 text-neutral-400">
                      {notification.message}
                    </p>
                  </div>
                );

                if (notification.link_url) {
                  return (
                    <Link
                      key={notification.id}
                      href={notification.link_url}
                      onClick={() => void handleNotificationClick(notification.id)}
                      className="block"
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
                    className="block w-full text-left"
                  >
                    {content}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex min-h-40 flex-col items-center justify-center px-6 text-center">
              <Bell className="h-5 w-5 text-neutral-600" />
              <p className="mt-3 text-sm font-medium text-neutral-200">No notifications yet</p>
              <p className="mt-1 text-xs leading-5 text-neutral-500">
                Task assignments and background jobs will start writing updates here.
              </p>
            </div>
          )}
        </div>

        {isFetching && !isLoading ? (
          <div className="border-t border-white/10 px-4 py-2 text-[11px] text-neutral-500">
            Refreshing…
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
