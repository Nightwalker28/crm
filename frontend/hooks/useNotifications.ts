"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";

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

  const query = useQuery({
    queryKey: ["user-notifications"],
    queryFn: fetchNotifications,
    refetchInterval: 60000,
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["user-notifications"] });
    },
  });

  return {
    notifications: query.data?.results ?? [],
    unreadCount: query.data?.unread_count ?? 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    markRead: markReadMutation.mutateAsync,
    markAllRead: markAllReadMutation.mutateAsync,
  };
}
