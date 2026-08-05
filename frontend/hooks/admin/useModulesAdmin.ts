"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { invalidateModuleCache } from "@/hooks/useAccessibleModules";
import { apiFetch } from "@/lib/api";

export type AdminModule = {
  id: number;
  name: string;
  base_route?: string | null;
  description?: string | null;
  is_enabled: boolean;
  import_duplicate_mode: "skip" | "overwrite" | "merge";
  sidebar_tab_key?: string | null;
  sidebar_tab_label?: string | null;
  display_name?: string | null;
};

export type SidebarTab = {
  id?: number | null;
  key: string;
  label: string;
  sort_order: number;
  is_system: boolean;
};

export type ModuleAccessDepartment = {
  id: number;
  name: string;
  description?: string | null;
  has_access: boolean;
};

export type ModuleAccessTeam = {
  id: number;
  name: string;
  description?: string | null;
  department_id?: number | null;
  department_name?: string | null;
  has_access: boolean;
  has_direct_access: boolean;
  direct_grant_allowed: boolean;
  access_state: "department_access" | "direct_team_access" | "blocked_by_department" | "blocked";
};

export type ModuleAccess = {
  module: AdminModule;
  departments: ModuleAccessDepartment[];
  teams: ModuleAccessTeam[];
};

async function fetchModules(): Promise<AdminModule[]> {
  const res = await apiFetch("/admin/users/modules");
  if (!res.ok) throw new Error("Module settings could not be loaded.");
  return res.json();
}

async function updateModule(moduleId: number, payload: Partial<AdminModule>) {
  const res = await apiFetch(`/admin/users/modules/${moduleId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("The module setting could not be updated.");
  return res.json();
}

async function fetchSidebarTabs(): Promise<SidebarTab[]> {
  const res = await apiFetch("/admin/users/sidebar-tabs");
  if (!res.ok) throw new Error("Sidebar groups could not be loaded.");
  return res.json();
}

async function createSidebarTab(payload: { label: string; key?: string; sort_order?: number }) {
  const res = await apiFetch("/admin/users/sidebar-tabs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("The sidebar group could not be created.");
  return res.json();
}

async function updateSidebarTab(tabKey: string, payload: { label?: string; sort_order?: number }) {
  const res = await apiFetch(`/admin/users/sidebar-tabs/${tabKey}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("The sidebar group could not be updated.");
  return res.json();
}

async function fetchModuleAccess(moduleId: number): Promise<ModuleAccess> {
  const res = await apiFetch(`/admin/users/modules/${moduleId}/access`);
  if (!res.ok) throw new Error("Module access could not be loaded.");
  return res.json();
}

export function useSidebarTabsAdmin() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["admin-sidebar-tabs"],
    queryFn: fetchSidebarTabs,
    refetchOnWindowFocus: false,
  });

  const createMutation = useMutation({
    mutationFn: createSidebarTab,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-sidebar-tabs"] });
      invalidateModuleCache();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ tabKey, payload }: { tabKey: string; payload: { label?: string; sort_order?: number } }) =>
      updateSidebarTab(tabKey, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-sidebar-tabs"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-modules"] }),
      ]);
      invalidateModuleCache();
    },
  });

  return {
    tabs: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    createTab: createMutation.mutateAsync,
    updateTab: (tabKey: string, payload: { label?: string; sort_order?: number }) =>
      updateMutation.mutateAsync({ tabKey, payload }),
    isSaving: createMutation.isPending || updateMutation.isPending,
  };
}

async function updateModuleAccess(
  moduleId: number,
  payload: { department_ids: number[]; team_ids: number[] },
): Promise<ModuleAccess> {
  const res = await apiFetch(`/admin/users/modules/${moduleId}/access`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (res.status === 409 && body?.detail?.code === "team_department_conflict") {
      throw new ModuleAccessConflictError();
    }
    throw new Error("Module access could not be updated.");
  }
  return res.json();
}

export class ModuleAccessConflictError extends Error {
  constructor() {
    super("Module access changed while you were editing.");
    this.name = "ModuleAccessConflictError";
  }
}

export function useModulesAdmin() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["admin-modules"],
    queryFn: fetchModules,
    refetchOnWindowFocus: false,
  });

  const mutation = useMutation({
    mutationFn: ({ moduleId, payload }: { moduleId: number; payload: Partial<AdminModule> }) =>
      updateModule(moduleId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-modules"] });
      invalidateModuleCache();
    },
  });

  return {
    modules: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    updateModule: (moduleId: number, payload: Partial<AdminModule>) => mutation.mutateAsync({ moduleId, payload }),
    isSaving: mutation.isPending,
  };
}

export function useModuleAccessAdmin(moduleId: number | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["admin-module-access", moduleId],
    queryFn: () => fetchModuleAccess(moduleId as number),
    enabled: moduleId != null,
    refetchOnWindowFocus: false,
  });

  const mutation = useMutation({
    mutationFn: (payload: { department_ids: number[]; team_ids: number[] }) =>
      updateModuleAccess(moduleId as number, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-module-access", moduleId] }),
        queryClient.invalidateQueries({ queryKey: ["admin-modules"] }),
      ]);
      invalidateModuleCache();
    },
  });

  return {
    access: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    updateAccess: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
}
