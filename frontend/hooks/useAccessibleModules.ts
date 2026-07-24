"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";

const LEGACY_MODULE_CACHE_KEY = "lynk_modules";
const PREVIOUS_MODULE_CACHE_KEY = "lynk_modules:v2";
const MODULE_CACHE_KEY = "lynk_modules:v3";

export type AccessibleModuleActions = {
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_restore: boolean;
  can_export: boolean;
  can_configure: boolean;
};

export type AccessibleModule = {
  id: number;
  name: string;
  base_route?: string | null;
  description?: string | null;
  is_enabled: boolean;
  sidebar_tab_key?: string | null;
  sidebar_tab_label?: string | null;
  display_name?: string | null;
  actions?: AccessibleModuleActions;
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

export function invalidateModuleCache() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(LEGACY_MODULE_CACHE_KEY);
  window.sessionStorage.removeItem(PREVIOUS_MODULE_CACHE_KEY);
  window.sessionStorage.removeItem(MODULE_CACHE_KEY);
}

function sameAccessibleModules(a: AccessibleModule[], b: AccessibleModule[]) {
  if (a.length !== b.length) return false;
  return a.every((item, index) => {
    const next = b[index];
    return (
      item.id === next.id &&
      item.name === next.name &&
      item.base_route === next.base_route &&
      item.description === next.description &&
      item.is_enabled === next.is_enabled &&
      item.sidebar_tab_key === next.sidebar_tab_key &&
      item.sidebar_tab_label === next.sidebar_tab_label &&
      item.display_name === next.display_name &&
      JSON.stringify(item.actions) === JSON.stringify(next.actions)
    );
  });
}

export function useAccessibleModules() {
  const [state, setState] = useState({
    modules: [] as AccessibleModule[],
    isLoading: true,
  });

  useEffect(() => {
    const cachedModules = readCachedModules();
    if (cachedModules !== null) {
      setState({ modules: cachedModules, isLoading: false });
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
            modules: nextModules && !sameAccessibleModules(current.modules, nextModules) ? nextModules : current.modules,
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
