"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import { useRealtimeNotifications } from "@/hooks/useRealtimeNotifications";

export type UserNotification = {
  id: number;
  user_id: number;
  category: string;
  title: string;
  message: string;
  status: string;
  link_url?: string | null;
  metadata?: Record<string, unknown> | null;
  read_at?: string | null;
  created_at: string;
  updated_at: string;
};

type NotificationListResponse = {
  results: UserNotification[];
  range_start: number;
  range_end: number;
  total_count: number;
  total_pages: number;
  page: number;
  page_size: number;
  unread_count: number;
};

type NotificationQueryData = {
  notifications: UserNotification[];
  unreadCount: number;
};

async function fetchNotifications(): Promise<NotificationListResponse> {
  const res = await apiFetch("/notifications?page=1&page_size=10");
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to fetch notifications.");
  }
  return body as NotificationListResponse;
}

async function markNotificationRead(notificationId: number) {
  const res = await apiFetch(`/notifications/${notificationId}/read`, {
    method: "POST",
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to update notification.");
  }
  return body;
}

async function markAllNotificationsRead() {
  const res = await apiFetch("/notifications/read-all", {
    method: "POST",
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to update notifications.");
  }
  return body;
}

export function useNotifications() {
  const queryClient = useQueryClient();
  const realtime = useRealtimeNotifications();

  const query = useQuery({
    queryKey: ["user-notifications"],
    queryFn: fetchNotifications,
    select: (data): NotificationQueryData => ({
      notifications: data.results,
      unreadCount: data.unread_count,
    }),
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    staleTime: 30000,
  });

  const markReadMutation = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["user-notifications"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["user-notifications"] });
      const previous = queryClient.getQueryData<NotificationListResponse>(["user-notifications"]);
      queryClient.setQueryData<NotificationListResponse>(["user-notifications"], (current) => {
        if (!current) return current;
        return {
          ...current,
          unread_count: 0,
          results: current.results.map((notification) => (
            notification.status === "unread"
              ? { ...notification, status: "read" }
              : notification
          )),
        };
      });
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["user-notifications"], context.previous);
      }
    },
  });

  return {
    notifications: query.data?.notifications ?? [],
    unreadCount: query.data?.unreadCount ?? 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    realtimeStatus: realtime.status,
    markRead: markReadMutation.mutateAsync,
    markAllRead: markAllReadMutation.mutateAsync,
  };
}
