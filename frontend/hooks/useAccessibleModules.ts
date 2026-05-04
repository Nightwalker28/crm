"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";

const MODULE_CACHE_KEY = "lynk_modules:v2";

export type AccessibleModule = {
  id: number;
  name: string;
  base_route?: string | null;
  description?: string | null;
  is_enabled: boolean;
};

export function useAccessibleModules() {
  const [modules, setModules] = useState<AccessibleModule[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/users/me/modules");
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const body = await res.json();
        if (cancelled) return;
        const next = Array.isArray(body) ? body : [];
        sessionStorage.setItem(MODULE_CACHE_KEY, JSON.stringify(next));
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
