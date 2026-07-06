"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { realtimeInitialStatus, subscribeRealtimeStream } from "@/lib/realtime";

export function useRealtimeNotifications(enabled = true) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState(realtimeInitialStatus);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const refreshNotifications = () => {
      void queryClient.invalidateQueries({ queryKey: ["user-notifications"] });
    };

    return subscribeRealtimeStream({
      "notification.created": refreshNotifications,
      "notification.updated": refreshNotifications,
    }, setStatus);
  }, [enabled, queryClient]);

  return { status };
}
