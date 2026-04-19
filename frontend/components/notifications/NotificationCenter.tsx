"use client";

import Link from "next/link";
import { Bell, CheckCheck, Loader2 } from "lucide-react";

import { useNotifications } from "@/hooks/useNotifications";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

function formatNotificationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function NotificationCenter() {
  const { notifications, unreadCount, isLoading, isFetching, markRead, markAllRead } = useNotifications();

  async function handleNotificationClick(notificationId: number) {
    try {
      await markRead(notificationId);
    } catch {
      // keep navigation usable even if the read mutation fails
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-white/5 text-neutral-300 transition-colors hover:bg-white/8 hover:text-neutral-100"
          aria-label="Open notifications"
        >
          <Bell className="h-4 w-4" />
          {unreadCount ? (
            <span className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[10px] font-semibold text-black">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" sideOffset={10} className="w-[360px] border-white/10 bg-neutral-950 p-0 text-neutral-100">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-neutral-100">Notifications</p>
            <p className="text-xs text-neutral-400">Background imports and exports will appear here first.</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs text-neutral-300 hover:bg-white/8 hover:text-white"
            onClick={() => void markAllRead()}
            disabled={!notifications.length}
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Mark all
          </Button>
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
                    className={`space-y-1 px-4 py-3 transition-colors ${
                      notification.status === "unread" ? "bg-white/[0.03]" : "bg-transparent"
                    } hover:bg-white/[0.05]`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium text-neutral-100">{notification.title}</p>
                      <span className="shrink-0 text-[11px] text-neutral-500">
                        {formatNotificationTime(notification.created_at)}
                      </span>
                    </div>
                    <p className="text-xs leading-5 text-neutral-400">{notification.message}</p>
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
                Import and export background jobs will start writing updates here.
              </p>
            </div>
          )}
        </div>

        {isFetching && !isLoading ? (
          <div className="border-t border-white/10 px-4 py-2 text-[11px] text-neutral-500">Refreshing…</div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
