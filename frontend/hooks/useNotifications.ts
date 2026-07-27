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
    throw new Error("Notifications could not be loaded.");
  }
  return body as NotificationListResponse;
}

async function markNotificationRead(notificationId: number) {
  const res = await apiFetch(`/notifications/${notificationId}/read`, {
    method: "POST",
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error("The notification could not be updated.");
  }
  return body;
}

async function markAllNotificationsRead() {
  const res = await apiFetch("/notifications/read-all", {
    method: "POST",
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error("Notifications could not be updated.");
  }
  return body;
}

export function useNotifications({ enableRealtime = false }: { enableRealtime?: boolean } = {}) {
  const queryClient = useQueryClient();
  const realtime = useRealtimeNotifications(enableRealtime);

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
    onMutate: async (notificationId) => {
      await queryClient.cancelQueries({ queryKey: ["user-notifications"] });
      const previous = queryClient.getQueryData<NotificationListResponse>(["user-notifications"]);
      queryClient.setQueryData<NotificationListResponse>(["user-notifications"], (current) => {
        if (!current) return current;
        const wasUnread = current.results.some(
          (notification) => notification.id === notificationId && notification.status === "unread",
        );
        return {
          ...current,
          unread_count: wasUnread ? Math.max(0, current.unread_count - 1) : current.unread_count,
          results: current.results.map((notification) => (
            notification.id === notificationId
              ? { ...notification, status: "read", read_at: notification.read_at ?? new Date().toISOString() }
              : notification
          )),
        };
      });
      return { previous };
    },
    onError: (_error, _notificationId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["user-notifications"], context.previous);
      }
    },
    onSettled: () => {
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
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["user-notifications"] });
    },
  });

  return {
    notifications: query.data?.notifications ?? [],
    unreadCount: query.data?.unreadCount ?? 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
    realtimeStatus: realtime.status,
    markRead: markReadMutation.mutateAsync,
    markAllRead: markAllReadMutation.mutateAsync,
    isMarkingAllRead: markAllReadMutation.isPending,
  };
}
