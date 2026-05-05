"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { useNotifications } from "@/hooks/useNotifications";

const SEEN_KEY = "lynk:browser-notification-seen";

function readSeenIds() {
  if (typeof window === "undefined") return new Set<number>();
  try {
    const raw = window.sessionStorage.getItem(SEEN_KEY);
    if (!raw) return new Set<number>();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is number => typeof item === "number") : []);
  } catch {
    return new Set<number>();
  }
}

function persistSeenIds(values: Set<number>) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(values)));
}

export default function BrowserNotificationsBridge() {
  const router = useRouter();
  const { notifications } = useNotifications();
  const seenIdsRef = useRef<Set<number>>(new Set<number>());

  useEffect(() => {
    seenIdsRef.current = readSeenIds();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    notifications
      .filter((notification) => notification.status === "unread" && notification.category.startsWith("task_"))
      .forEach((notification) => {
        if (seenIdsRef.current.has(notification.id)) return;

        seenIdsRef.current.add(notification.id);
        persistSeenIds(seenIdsRef.current);

        const browserNotification = new Notification(notification.title, {
          body: notification.message,
          tag: `lynk-task-${notification.id}`,
        });

        browserNotification.onclick = () => {
          window.focus();
          router.push(notification.link_url || "/dashboard/tasks");
          browserNotification.close();
        };
      });
  }, [notifications, router]);

  return null;
}
