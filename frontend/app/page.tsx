"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import LynkSplash from "@/components/LynkSplash";
import { apiFetch } from "@/lib/api";

export default function RootRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;

    (async () => {
      try {
        const res = await apiFetch("/users/me");
        if (res.ok) {
          if (!cancelled) router.replace("/dashboard");
          return;
        }
        if (!cancelled) router.replace("/auth/login");
      } catch {
        if (!cancelled) {
          router.replace("/auth/login");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  // This returned `null` — so the entry route was a blank ground for as long as `/users/me`
  // took, which on a cold backend is seconds. The splash is the shape the app is about to
  // take, and it is already what `app/loading.tsx` shows for the same wait.
  return (
    <div className="fixed inset-0 z-[100] min-h-screen">
      <LynkSplash />
    </div>
  );
}
