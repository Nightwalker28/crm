"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { apiFetch } from "@/lib/api";

const USER_CACHE_KEY = "lynk_user";
const USER_VERIFIED_AT_KEY = "lynk_user_verified_at";
const USER_VERIFICATION_TTL_MS = 5 * 60_000;

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

  const cached = sessionStorage.getItem(USER_CACHE_KEY);
  if (!cached) return null;

  try {
    return JSON.parse(cached) as UserProfile;
  } catch {
    sessionStorage.removeItem(USER_CACHE_KEY);
    sessionStorage.removeItem(USER_VERIFIED_AT_KEY);
    return null;
  }
}

function hasFreshUserVerification() {
  if (typeof window === "undefined") return false;
  const rawValue = sessionStorage.getItem(USER_VERIFIED_AT_KEY);
  if (!rawValue) return false;
  const verifiedAt = Number(rawValue);
  return Number.isFinite(verifiedAt) && Date.now() - verifiedAt < USER_VERIFICATION_TTL_MS;
}

function clearAuthStorage() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(USER_CACHE_KEY);
  sessionStorage.removeItem(USER_VERIFIED_AT_KEY);
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
    const cachedUser = safeReadCachedUser();
    setUser(cachedUser);
    if (cachedUser && hasFreshUserVerification()) {
      setVerified(true);
    }
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

        sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(me));
        sessionStorage.setItem(USER_VERIFIED_AT_KEY, String(Date.now()));
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
