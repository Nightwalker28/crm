// app/providers.tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ConfirmProvider } from "@/hooks/useConfirm";
import { subscribeToAuthSessionChanges } from "@/lib/authSessionEvents";

export default function Providers({ children }: { children: React.ReactNode }) {
  // Ensure QueryClient is created only once per client lifecycle
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            retry: 1,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
          },
        },
      })
  );

  useEffect(
    () =>
      subscribeToAuthSessionChanges((source) => {
        window.sessionStorage.clear();
        queryClient.clear();
        if (source === "cross-tab") window.location.reload();
      }),
    [queryClient]
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ConfirmProvider>{children}</ConfirmProvider>
    </QueryClientProvider>
  );
}
