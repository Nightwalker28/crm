// app/providers.tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { ThemeProvider } from "next-themes";
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
    // Without this mounted, useTheme() in the Toaster fell back to "system" and
    // toasts followed the OS instead of the app - light toasts on a dark shell.
    // value maps "light" to the .light class; dark needs no class because :root
    // already is the dark set.
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
      value={{ light: "light", dark: "dark" }}
    >
      <QueryClientProvider client={queryClient}>
        {/* The reduced-motion block in globals.css cannot reach motion/react -
            Checkbox and Switch animate scale in JS. "user" makes the library
            read the same media query, so design.md 6 holds for both halves. */}
        <MotionConfig reducedMotion="user">
          <ConfirmProvider>{children}</ConfirmProvider>
        </MotionConfig>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
