"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";

export type AdminModule = {
  id: number;
  name: string;
  base_route?: string | null;
  description?: string | null;
  is_enabled: boolean;
  import_duplicate_mode: "skip" | "overwrite" | "merge";
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
};

export type ModuleAccess = {
  module: AdminModule;
  departments: ModuleAccessDepartment[];
  teams: ModuleAccessTeam[];
};

async function fetchModules(): Promise<AdminModule[]> {
  const res = await apiFetch("/admin/users/modules");
  if (!res.ok) throw new Error(`Failed with ${res.status}`);
  return res.json();
}

async function updateModule(moduleId: number, payload: Partial<AdminModule>) {
  const res = await apiFetch(`/admin/users/modules/${moduleId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Failed with ${res.status}`);
  return res.json();
}

async function fetchModuleAccess(moduleId: number): Promise<ModuleAccess> {
  const res = await apiFetch(`/admin/users/modules/${moduleId}/access`);
  if (!res.ok) throw new Error(`Failed with ${res.status}`);
  return res.json();
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
  if (!res.ok) throw new Error(`Failed with ${res.status}`);
  return res.json();
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
      if (typeof window !== "undefined") {
        sessionStorage.removeItem("lynk_modules");
        sessionStorage.removeItem("lynk_modules:v2");
      }
    },
  });

  return {
    modules: query.data ?? [],
    isLoading: query.isLoading,
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
      if (typeof window !== "undefined") {
        sessionStorage.removeItem("lynk_modules");
        sessionStorage.removeItem("lynk_modules:v2");
      }
    },
  });

  return {
    access: query.data ?? null,
    isLoading: query.isLoading,
    updateAccess: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
}
