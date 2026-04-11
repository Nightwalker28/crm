"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
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
          if (!cancelled) router.replace("/dashboard/users");
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

  return null;
}
