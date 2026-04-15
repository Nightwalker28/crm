"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";

export type AccessibleModule = {
  id: number;
  name: string;
  base_route?: string | null;
  description?: string | null;
  is_enabled: boolean;
};

function readCachedModules(): AccessibleModule[] {
  if (typeof window === "undefined") return [];
  const raw = sessionStorage.getItem("lynk_modules");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    sessionStorage.removeItem("lynk_modules");
    return [];
  }
}

export function useAccessibleModules() {
  const [modules, setModules] = useState<AccessibleModule[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const cached = readCachedModules();
    if (cached.length) {
      setModules(cached);
      setIsLoading(false);
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/users/me/modules");
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const body = await res.json();
        if (cancelled) return;
        const next = Array.isArray(body) ? body : [];
        sessionStorage.setItem("lynk_modules", JSON.stringify(next));
        setModules(next);
      } catch {
        if (cancelled) return;
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { modules, isLoading };
}
