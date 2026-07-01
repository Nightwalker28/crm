"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiFetch } from "@/lib/api";

export type RoleSummary = {
  id: number;
  name: string;
  level: number;
  description?: string | null;
};

export type RoleTemplate = {
  key: string;
  label: string;
  description: string;
};

export type ModulePermission = {
  module_id: number;
  module_name: string;
  module_description?: string | null;
  actions: {
    can_view: boolean;
    can_create: boolean;
    can_edit: boolean;
    can_delete: boolean;
    can_restore: boolean;
    can_export: boolean;
    can_configure: boolean;
  };
};

type OverviewResponse = {
  roles: RoleSummary[];
  templates: RoleTemplate[];
  modules: ModulePermission[];
};

async function fetchOverview(): Promise<OverviewResponse> {
  const res = await apiFetch("/admin/users/roles/permissions");
  if (!res.ok) throw new Error("Failed to load roles and permissions");
  return res.json();
}

async function fetchRolePermissions(roleId: number): Promise<ModulePermission[]> {
  const res = await apiFetch(`/admin/users/roles/${roleId}/permissions`);
  if (!res.ok) throw new Error("Failed to load role permissions");
  return res.json();
}

export function useRolePermissions() {
  const queryClient = useQueryClient();
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);

  const overviewQuery = useQuery({
    queryKey: ["role-permission-overview"],
    queryFn: fetchOverview,
  });

  const roles = useMemo(() => overviewQuery.data?.roles ?? [], [overviewQuery.data?.roles]);
  const templates = useMemo(() => overviewQuery.data?.templates ?? [], [overviewQuery.data?.templates]);

  useEffect(() => {
    if (!roles.length) return;
    const selectedRoleExists = selectedRoleId != null && roles.some((role) => role.id === selectedRoleId);
    if (selectedRoleId == null || !selectedRoleExists) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedRoleId(roles[0].id);
    }
  }, [roles, selectedRoleId]);

  const permissionsQuery = useQuery({
    queryKey: ["role-permissions", selectedRoleId],
    queryFn: () => fetchRolePermissions(selectedRoleId as number),
    enabled: selectedRoleId != null,
  });
  const permissions = useMemo(() => permissionsQuery.data ?? [], [permissionsQuery.data]);

  async function createRole(payload: { name: string; description?: string; level?: number; template_key: string }) {
    const res = await apiFetch("/admin/users/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(body?.detail ?? `Failed with ${res.status}`);
    }
    await queryClient.invalidateQueries({ queryKey: ["role-permission-overview"] });
    setSelectedRoleId(body.id);
    toast.success("Role created.");
  }

  async function updatePermissions(roleId: number, permissions: ModulePermission[]) {
    const res = await apiFetch(`/admin/users/roles/${roleId}/permissions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        permissions: permissions.map((permission) => ({
          module_id: permission.module_id,
          actions: permission.actions,
        })),
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(body?.detail ?? `Failed with ${res.status}`);
    }
    await queryClient.invalidateQueries({ queryKey: ["role-permissions", roleId] });
    toast.success("Permissions updated.");
  }

  return {
    roles,
    templates,
    selectedRoleId,
    setSelectedRoleId,
    permissions,
    isLoading: overviewQuery.isLoading || permissionsQuery.isLoading,
    createRole,
    updatePermissions,
  };
}
