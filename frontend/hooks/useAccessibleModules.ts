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

function readCachedModules(): AccessibleModule[] | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const cached = window.sessionStorage.getItem(MODULE_CACHE_KEY);
    if (!cached) {
      return null;
    }
    const parsed = JSON.parse(cached);
    return Array.isArray(parsed) ? (parsed as AccessibleModule[]) : null;
  } catch {
    window.sessionStorage.removeItem(MODULE_CACHE_KEY);
    return null;
  }
}

export function useAccessibleModules() {
  const [state, setState] = useState(() => {
    const cachedModules = readCachedModules();
    return {
      modules: cachedModules ?? [],
      isLoading: cachedModules === null,
    };
  });

  useEffect(() => {
    if (readCachedModules() !== null) {
      return;
    }

    let cancelled = false;
    (async () => {
      let nextModules: AccessibleModule[] | null = null;
      try {
        const res = await apiFetch("/users/me/modules");
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const body = await res.json();
        if (cancelled) return;
        const next = Array.isArray(body) ? body : [];
        sessionStorage.setItem(MODULE_CACHE_KEY, JSON.stringify(next));
        nextModules = next;
      } catch {
        if (cancelled) return;
      } finally {
        if (!cancelled) {
          setState((current) => ({
            modules: nextModules ?? current.modules,
            isLoading: false,
          }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
