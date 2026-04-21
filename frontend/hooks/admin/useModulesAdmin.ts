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
