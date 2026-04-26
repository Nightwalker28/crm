"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { apiFetch } from "@/lib/api";

type UserProfile = {
  id?: number;
  email?: string;
  first_name?: string;
  last_name?: string;
  photo_url?: string;
  role_id?: number | null;
  role_name?: string | null;
  role_level?: number | null;
  is_admin?: boolean;
};

function safeReadCachedUser(): UserProfile | null {
  if (typeof window === "undefined") return null;

  const cached = sessionStorage.getItem("lynk_user");
  if (!cached) return null;

  try {
    return JSON.parse(cached) as UserProfile;
  } catch {
    sessionStorage.removeItem("lynk_user");
    return null;
  }
}

function clearAuthStorage() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem("lynk_user");
  sessionStorage.removeItem("lynk_modules");
  sessionStorage.removeItem("lynk_modules:v2");
}

export function useSidebarUser() {
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [verified, setVerified] = useState(false);
  const needsFreshUser = hydrated && !verified;

  useEffect(() => {
    setUser(safeReadCachedUser());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!needsFreshUser) return;

    let cancelled = false;

    (async () => {
      try {
        const res = await apiFetch("/users/me");
        if (!res.ok) throw new Error(`Status ${res.status}`);

        const me = (await res.json()) as UserProfile;
        if (cancelled) return;

        sessionStorage.setItem("lynk_user", JSON.stringify(me));
        setUser(me);
        setVerified(true);
      } catch {
        if (cancelled) return;
        clearAuthStorage();
        router.replace("/auth/login");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [needsFreshUser, router]);

  async function logout() {
    await apiFetch("/auth/logout", {
      method: "POST",
    });

    sessionStorage.clear();
    setVerified(false);
    router.push("/auth/login");
  }

  return {
    user,
    isLoading: !hydrated || needsFreshUser,
    isAdmin: verified && Boolean(user?.is_admin),
    logout,
  };
}
