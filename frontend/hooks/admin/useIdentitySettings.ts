"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiFetch } from "@/lib/api";
import type { MfaPolicy, PasswordPolicy, SsoSettings, SsoSettingsUpdate, SsoTestResult, TenantDomain, UserOptionsData } from "./useUserManagement";

async function readJson<T>(path: string, message: string): Promise<T> {
  const response = await apiFetch(path);
  if (!response.ok) throw new Error(message);
  return response.json();
}

function useSsoSettingsQuery() {
  return useQuery<SsoSettings>({ queryKey: ["admin-sso-settings"], queryFn: () => readJson("/admin/users/sso-settings", "Failed to fetch SSO settings"), staleTime: 300_000, refetchOnWindowFocus: false });
}

function useSsoUpdate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: SsoSettingsUpdate) => {
      const response = await apiFetch("/admin/users/sso-settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.detail ?? body?.message ?? `Status ${response.status}`);
      return body as SsoSettings;
    },
    onSuccess: (settings) => { queryClient.setQueryData(["admin-sso-settings"], settings); toast.success("SSO settings updated."); },
    onError: () => toast.error("SSO settings could not be updated. Please try again."),
  });
}

export function useAuthenticationSettings() {
  const queryClient = useQueryClient();
  const mfa = useQuery<{ policy: MfaPolicy }>({ queryKey: ["admin-mfa-policy"], queryFn: () => readJson("/admin/users/mfa-policy", "Failed to fetch MFA policy"), staleTime: 300_000, refetchOnWindowFocus: false });
  const password = useQuery<PasswordPolicy>({ queryKey: ["password-policy"], queryFn: () => readJson("/auth/password-policy", "Failed to fetch password policy"), staleTime: 1_800_000, refetchOnWindowFocus: false });
  const sso = useSsoSettingsQuery();
  const updateSso = useSsoUpdate();
  const updateMfa = useMutation({
    mutationFn: async (policy: MfaPolicy) => {
      const response = await apiFetch("/admin/users/mfa-policy", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ policy }) });
      if (!response.ok) throw new Error("MFA policy update failed");
      return response.json() as Promise<{ policy: MfaPolicy }>;
    },
    onSuccess: (data) => { queryClient.setQueryData(["admin-mfa-policy"], data); void queryClient.invalidateQueries({ queryKey: ["users-paged"] }); toast.success("MFA policy updated."); },
    onError: () => toast.error("MFA policy could not be updated. Please try again."),
  });
  const testSso = useMutation({
    mutationFn: async () => {
      const response = await apiFetch("/admin/users/sso-settings/test", { method: "POST" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.detail ?? body?.message ?? `Status ${response.status}`);
      return body as SsoTestResult;
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["admin-sso-settings"] });
      if (result.ok) toast.success("SSO configuration test passed.");
      else toast.error("SSO connection failed. Review the provider settings and try again.");
    },
    onError: () => toast.error("SSO connection could not be tested. Review the provider settings and try again."),
  });
  return { mfaPolicy: mfa.data?.policy ?? "off", passwordPolicy: password.data, ssoSettings: sso.data, isLoading: mfa.isLoading || sso.isLoading, isPasswordPolicyLoading: password.isLoading, isSaving: updateMfa.isPending || updateSso.isPending, isTesting: testSso.isPending, updateMfaPolicy: updateMfa.mutate, updateSsoSettings: updateSso.mutateAsync, testSsoSettings: testSso.mutateAsync };
}

export function useProvisioningSettings() {
  const sso = useSsoSettingsQuery();
  const updateSso = useSsoUpdate();
  const options = useQuery<UserOptionsData>({ queryKey: ["user-options"], queryFn: () => readJson("/admin/users/options", "Failed to fetch user options"), staleTime: 600_000, refetchOnWindowFocus: false });
  return { ssoSettings: sso.data, roles: options.data?.roles ?? [], teams: options.data?.teams ?? [], isLoading: sso.isLoading || options.isLoading, isSaving: updateSso.isPending, updateSsoSettings: updateSso.mutateAsync };
}

export function useDomainSettings() {
  const queryClient = useQueryClient();
  const domains = useQuery<TenantDomain[]>({ queryKey: ["admin-tenant-domains"], queryFn: () => readJson("/admin/users/domains", "Failed to fetch custom domains"), staleTime: 300_000, refetchOnWindowFocus: false });
  const create = useDomainMutation(queryClient, "POST", "Custom domain added.", "The custom domain could not be added. Please try again.");
  const verify = useDomainMutation(queryClient, "POST", "Custom domain verified.", "The custom domain could not be verified. Please try again.");
  const remove = useDomainMutation(queryClient, "DELETE", "Custom domain removed.", "The custom domain could not be removed. Please try again.");
  return { tenantDomains: domains.data ?? [], isLoading: domains.isLoading, isSaving: create.isPending || verify.isPending || remove.isPending, createTenantDomain: (payload: { hostname: string; is_primary?: boolean }) => create.mutateAsync({ path: "/admin/users/domains", payload }), verifyTenantDomain: (id: number) => verify.mutateAsync({ path: `/admin/users/domains/${id}/verify` }), deleteTenantDomain: (id: number) => remove.mutateAsync({ path: `/admin/users/domains/${id}` }) };
}

function useDomainMutation(queryClient: ReturnType<typeof useQueryClient>, method: "POST" | "DELETE", successMessage: string, errorMessage: string) {
  return useMutation({
    mutationFn: async ({ path, payload }: { path: string; payload?: unknown }) => {
      const response = await apiFetch(path, { method, ...(payload ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) } : {}) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.detail ?? body?.message ?? `Status ${response.status}`);
      return body;
    },
    onSuccess: () => toast.success(successMessage),
    onError: () => toast.error(errorMessage),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["admin-tenant-domains"] }),
  });
}
