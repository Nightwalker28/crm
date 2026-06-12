"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import type { User } from "@/components/users/userManagementTable";

type UserOption = { id: number; name: string };
type AuthMode = "manual_only" | "manual_or_google";
type UserStatus = "active" | "inactive";
export type MfaPolicy = "off" | "admins_only" | "all_users";

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
  last_successful_login_at: string | null;
  last_failed_login_reason: string | null;
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
  created_at: string | null;
};

export type SsoTestResult = {
  ok: boolean;
  message: string;
  checked_at: string;
  metadata: Record<string, string>;
  errors: string[];
};

export type SsoSettingsUpdate = Partial<Omit<SsoSettings, "provider_type" | "has_client_secret" | "status" | "last_test_result" | "last_successful_login_at" | "last_failed_login_reason">> & {
  client_secret?: string | null;
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

type CreateUserResult = {
  setup_link?: string | null;
};

const EMPTY_USER_OPTIONS: UserOptionsData = {
  roles: [],
  teams: [],
  statuses: [],
};

type StoredUser = {
  id?: unknown;
};

function parseStoredUser(raw: string | null): number | null {
  if (!raw) return null;

  try {
    const parsed: StoredUser = JSON.parse(raw);
    return typeof parsed.id === "number" ? parsed.id : null;
  } catch (error) {
    console.error("Invalid lynk_user format", error);
    return null;
  }
}

export function useUserManagement() {
  const queryClient = useQueryClient();

  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [editUserData, setEditUserData] = useState<User | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentUserId(parseStoredUser(sessionStorage.getItem("lynk_user")));
  }, []);

  const optionsQuery = useQuery<UserOptionsData>({
    queryKey: ["user-options"],
    queryFn: async () => {
      const res = await apiFetch("/admin/users/options");
      if (!res.ok) throw new Error("Failed to fetch options");
      return res.json();
    },
    staleTime: 1000 * 60 * 10,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
  });

  const mfaPolicyQuery = useQuery<{ policy: MfaPolicy }>({
    queryKey: ["admin-mfa-policy"],
    queryFn: async () => {
      const res = await apiFetch("/admin/users/mfa-policy");
      if (!res.ok) throw new Error("Failed to fetch MFA policy");
      return res.json();
    },
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });

  const ssoSettingsQuery = useQuery<SsoSettings>({
    queryKey: ["admin-sso-settings"],
    queryFn: async () => {
      const res = await apiFetch("/admin/users/sso-settings");
      if (!res.ok) throw new Error("Failed to fetch SSO settings");
      return res.json();
    },
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });

  const domainsQuery = useQuery<TenantDomain[]>({
    queryKey: ["admin-tenant-domains"],
    queryFn: async () => {
      const res = await apiFetch("/admin/users/domains");
      if (!res.ok) throw new Error("Failed to fetch custom domains");
      return res.json();
    },
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });

  const updateMfaPolicyMutation = useMutation({
    mutationFn: async (policy: MfaPolicy) => {
      const res = await apiFetch("/admin/users/mfa-policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policy }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? body?.message ?? `Status ${res.status}`);
      }
      return res.json();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-mfa-policy"] }),
        queryClient.invalidateQueries({ queryKey: ["users-paged"] }),
      ]);
      toast.success("MFA policy updated.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to update MFA policy.");
    },
  });

  const resetUserMfaMutation = useMutation({
    mutationFn: async (userId: number) => {
      const res = await apiFetch(`/admin/users/${userId}/mfa-reset`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? body?.message ?? `Status ${res.status}`);
      }
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["users-paged"] });
      toast.success("MFA reset.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to reset MFA.");
    },
  });

  const updateSsoSettingsMutation = useMutation({
    mutationFn: async (payload: SsoSettingsUpdate) => {
      const res = await apiFetch("/admin/users/sso-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? body?.message ?? `Status ${res.status}`);
      }
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-sso-settings"] });
      toast.success("SSO settings updated.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to update SSO settings.");
    },
  });

  const testSsoSettingsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/admin/users/sso-settings/test", {
        method: "POST",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.detail ?? body?.message ?? `Status ${res.status}`);
      }
      return body as SsoTestResult;
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-sso-settings"] });
      if (result.ok) {
        toast.success("SSO configuration test passed.");
      } else {
        toast.error(result.message || "SSO configuration test failed.");
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to test SSO settings.");
    },
  });

  const createDomainMutation = useMutation({
    mutationFn: async (payload: { hostname: string; is_primary?: boolean }) => {
      const res = await apiFetch("/admin/users/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? body?.message ?? `Status ${res.status}`);
      return body as TenantDomain;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-tenant-domains"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-sso-settings"] }),
      ]);
      toast.success("Custom domain added.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to add custom domain.");
    },
  });

  const verifyDomainMutation = useMutation({
    mutationFn: async (domainId: number) => {
      const res = await apiFetch(`/admin/users/domains/${domainId}/verify`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? body?.message ?? `Status ${res.status}`);
      return body as TenantDomain;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-tenant-domains"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-sso-settings"] }),
      ]);
      toast.success("Custom domain verified.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to verify custom domain.");
    },
  });

  const deleteDomainMutation = useMutation({
    mutationFn: async (domainId: number) => {
      const res = await apiFetch(`/admin/users/domains/${domainId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? body?.message ?? `Status ${res.status}`);
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-tenant-domains"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-sso-settings"] }),
      ]);
      toast.success("Custom domain removed.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to remove custom domain.");
    },
  });

  async function refreshUsers() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["users-paged"] }),
      queryClient.invalidateQueries({ queryKey: ["user-options"] }),
      queryClient.refetchQueries({ queryKey: ["users-paged"], type: "active" }),
      queryClient.refetchQueries({ queryKey: ["user-options"], type: "active" }),
    ]);
  }

  async function createUser(form: CreateUserForm): Promise<CreateUserResult> {
    const res = await apiFetch("/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(body?.detail ?? body?.message ?? `Status ${res.status}`);
    }

    await refreshUsers();
    toast.success("User created.");
    return {
      setup_link: body?.setup_link ?? null,
    };
  }

  async function updateUser(id: number, form: Partial<User>) {
    const res = await apiFetch(`/admin/users/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.detail ?? body?.message ?? `Status ${res.status}`);
    }

    await refreshUsers();
    toast.success("User updated.");
  }

  function openEditModal(user: User) {
    setEditUserData(user);
    setIsEditOpen(true);
  }

  function closeEditModal() {
    setIsEditOpen(false);
    setEditUserData(null);
  }

  function openCreateModal() {
    setIsCreateOpen(true);
  }

  function closeCreateModal() {
    setIsCreateOpen(false);
  }

  return {
    currentUserId,
    editUserData,
    isEditOpen,
    isCreateOpen,
    optionsData: optionsQuery.data ?? EMPTY_USER_OPTIONS,
    mfaPolicy: mfaPolicyQuery.data?.policy ?? "off",
    isMfaPolicyLoading: mfaPolicyQuery.isLoading,
    isMfaPolicySaving: updateMfaPolicyMutation.isPending,
    ssoSettings: ssoSettingsQuery.data,
    tenantDomains: domainsQuery.data ?? [],
    isTenantDomainsLoading: domainsQuery.isLoading,
    isTenantDomainSaving: createDomainMutation.isPending || verifyDomainMutation.isPending || deleteDomainMutation.isPending,
    isSsoSettingsLoading: ssoSettingsQuery.isLoading,
    isSsoSettingsSaving: updateSsoSettingsMutation.isPending,
    isSsoSettingsTesting: testSsoSettingsMutation.isPending,
    roles: optionsQuery.data?.roles ?? EMPTY_USER_OPTIONS.roles,
    teams: optionsQuery.data?.teams ?? EMPTY_USER_OPTIONS.teams,
    openEditModal,
    closeEditModal,
    openCreateModal,
    closeCreateModal,
    createUser,
    updateUser,
    updateMfaPolicy: (policy: MfaPolicy) => updateMfaPolicyMutation.mutate(policy),
    resetUserMfa: (userId: number) => resetUserMfaMutation.mutateAsync(userId),
    isResettingUserMfa: resetUserMfaMutation.isPending,
    updateSsoSettings: (payload: SsoSettingsUpdate) => updateSsoSettingsMutation.mutateAsync(payload),
    testSsoSettings: () => testSsoSettingsMutation.mutateAsync(),
    createTenantDomain: (payload: { hostname: string; is_primary?: boolean }) => createDomainMutation.mutateAsync(payload),
    verifyTenantDomain: (domainId: number) => verifyDomainMutation.mutateAsync(domainId),
    deleteTenantDomain: (domainId: number) => deleteDomainMutation.mutateAsync(domainId),
  };
}
