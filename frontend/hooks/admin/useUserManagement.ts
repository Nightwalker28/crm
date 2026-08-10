"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { User } from "@/components/users/userManagementTable";
import { apiFetch } from "@/lib/api";

export type UserOption = { id: number; name: string };
type AuthMode = "manual_only" | "manual_or_google";
type UserStatus = "active" | "inactive";
export type MfaPolicy = "off" | "admins_only" | "all_users";
export type PasswordPolicy = { min_length: number; requirements: string[] };
export type SsoTestResult = {
  ok: boolean;
  message: string;
  checked_at: string;
  metadata: Record<string, string>;
  errors: string[];
};
export type SsoSettings = {
  enabled: boolean;
  provider_type: "oidc";
  issuer_url: string | null;
  authorization_endpoint: string | null;
  token_endpoint: string | null;
  userinfo_endpoint: string | null;
  jwks_uri: string | null;
  client_id: string | null;
  has_client_secret: boolean;
  allowed_email_domains: string[];
  auto_provision_users: boolean;
  default_role_id: number | null;
  default_team_id: number | null;
  email_claim: string;
  first_name_claim: string | null;
  last_name_claim: string | null;
  status: string;
  last_test_result: SsoTestResult | null;
  last_successful_test: SsoTestResult | null;
  last_failed_test: SsoTestResult | null;
  last_successful_login_at: string | null;
  last_failed_login_reason: string | null;
};
export type SsoSettingsUpdate = Partial<Omit<SsoSettings,
  "provider_type" | "has_client_secret" | "status" | "last_test_result" |
  "last_successful_login_at" | "last_failed_login_reason">> & {
  client_secret?: string | null;
};
export type TenantDomain = {
  id: number;
  hostname: string;
  is_primary: boolean;
  status: "pending" | "verified" | "failed" | string;
  verification_token: string | null;
  txt_record_name: string;
  txt_record_value: string | null;
  verified_at: string | null;
  last_checked_at: string | null;
  created_at: string | null;
};
export type UserOptionsData = {
  roles: UserOption[];
  teams: UserOption[];
  statuses: string[];
};
export type CreateUserForm = {
  first_name: string;
  last_name: string;
  email: string;
  role_id: number;
  team_id: number;
  auth_mode: AuthMode;
  is_active: UserStatus;
};
export type BulkUserUpdate = { role_id?: number; is_active?: UserStatus };

const EMPTY_OPTIONS: UserOptionsData = { roles: [], teams: [], statuses: [] };

function storedUserId(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.sessionStorage.getItem("lynk_user") ?? "null") as { id?: unknown } | null;
    return typeof value?.id === "number" ? value.id : null;
  } catch {
    return null;
  }
}

export function useUserManagement() {
  const queryClient = useQueryClient();
  const [currentUserId] = useState(storedUserId);
  const [editUserData, setEditUserData] = useState<User | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const optionsQuery = useQuery<UserOptionsData>({
    queryKey: ["user-options"],
    queryFn: async () => {
      const response = await apiFetch("/admin/users/options");
      if (!response.ok) throw new Error("Failed to fetch user options");
      return response.json();
    },
    staleTime: 600_000,
    refetchOnWindowFocus: false,
  });
  const resetMfa = useMutation({
    mutationFn: async (userId: number) => {
      const response = await apiFetch(`/admin/users/${userId}/mfa-reset`, { method: "POST" });
      if (!response.ok) throw new Error("MFA could not be reset");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["users-paged"] });
      toast.success("MFA reset.");
    },
    onError: () => toast.error("MFA could not be reset. Please try again."),
  });

  async function refreshUsers() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["users-paged"] }),
      queryClient.invalidateQueries({ queryKey: ["user-options"] }),
    ]);
  }
  async function createUser(form: CreateUserForm) {
    const response = await apiFetch("/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.detail ?? body?.message ?? `Status ${response.status}`);
    await refreshUsers();
    toast.success("User created.");
    return { setup_link: body?.setup_link ?? null };
  }
  async function updateUser(id: number, form: Partial<User>) {
    const response = await apiFetch(`/admin/users/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.detail ?? body?.message ?? `Status ${response.status}`);
    await refreshUsers();
    toast.success("User updated.");
  }
  async function bulkUpdateUsers(userIds: number[], changes: BulkUserUpdate) {
    const response = await apiFetch("/admin/users/bulk", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_ids: userIds, ...changes }) });
    if (!response.ok) throw new Error("The selected users could not be updated.");
    await refreshUsers();
    toast.success(`${userIds.length} user${userIds.length === 1 ? "" : "s"} updated.`);
  }
  return {
    currentUserId,
    editUserData,
    isEditOpen,
    isCreateOpen,
    optionsData: optionsQuery.data ?? EMPTY_OPTIONS,
    roles: optionsQuery.data?.roles ?? EMPTY_OPTIONS.roles,
    teams: optionsQuery.data?.teams ?? EMPTY_OPTIONS.teams,
    openEditModal: (user: User) => { setEditUserData(user); setIsEditOpen(true); },
    closeEditModal: () => { setIsEditOpen(false); setEditUserData(null); },
    openCreateModal: () => setIsCreateOpen(true),
    closeCreateModal: () => setIsCreateOpen(false),
    createUser,
    updateUser,
    bulkUpdateUsers,
    resetUserMfa: resetMfa.mutateAsync,
    isResettingUserMfa: resetMfa.isPending,
  };
}
