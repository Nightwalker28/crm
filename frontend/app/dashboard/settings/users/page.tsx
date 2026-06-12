"use client";

import { Globe2, Plus, ShieldCheck, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/PageHeader";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserManagementTable, type SortDirection, type SortKey } from "@/components/users/userManagementTable";
import CreateUserDialog from "@/components/users/createUserDialog";
import EditUserDialog from "@/components/users/editUserDialog";
import { useUserManagement, type MfaPolicy } from "@/hooks/admin/useUserManagement";
import { useSavedViews } from "@/hooks/useSavedViews";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { formatDateTime } from "@/lib/datetime";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS, resolveSavedViewFilters, resolveVisibleColumns } from "@/lib/moduleViewConfigs";
import type { UserFiltersValue } from "@/components/users/userFilters";
import { useEffect, useMemo, useState } from "react";

type SsoDraft = {
  enabled: boolean;
  issuer_url: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  client_id: string;
  client_secret: string;
  auto_provision_users: boolean;
  default_role_id: string;
  default_team_id: string;
  email_claim: string;
  first_name_claim: string;
  last_name_claim: string;
};

const emptySsoDraft: SsoDraft = {
  enabled: false,
  issuer_url: "",
  authorization_endpoint: "",
  token_endpoint: "",
  userinfo_endpoint: "",
  jwks_uri: "",
  client_id: "",
  client_secret: "",
  auto_provision_users: false,
  default_role_id: "",
  default_team_id: "",
  email_claim: "email",
  first_name_claim: "given_name",
  last_name_claim: "family_name",
};

export default function UserManagementPage() {
  const { fields: moduleFields } = useModuleFieldConfigs("admin_users");
  const definition = useMemo(() => buildModuleViewDefinition("admin_users", [], moduleFields), [moduleFields]);
  const defaultConfig = definition?.defaultConfig ?? MODULE_VIEW_DEFAULTS.admin_users;
  const {
    currentUserId,
    editUserData,
    isEditOpen,
    isCreateOpen,
    optionsData,
    mfaPolicy,
    isMfaPolicyLoading,
    isMfaPolicySaving,
    ssoSettings,
    isSsoSettingsLoading,
    isSsoSettingsSaving,
    isSsoSettingsTesting,
    tenantDomains,
    isTenantDomainsLoading,
    isTenantDomainSaving,
    roles,
    teams,
    openEditModal,
    closeEditModal,
    openCreateModal,
    closeCreateModal,
    createUser,
    updateUser,
    updateMfaPolicy,
    resetUserMfa,
    isResettingUserMfa,
    updateSsoSettings,
    testSsoSettings,
    createTenantDomain,
    verifyTenantDomain,
    deleteTenantDomain,
  } = useUserManagement();
  const [ssoDraft, setSsoDraft] = useState<SsoDraft>(emptySsoDraft);
  const [domainDraft, setDomainDraft] = useState("");
  const {
    views,
    selectedViewId,
    setSelectedViewId,
    draftConfig,
    setDraftConfig,
  } = useSavedViews(
    "admin_users",
    defaultConfig,
  );
  const visibleColumns = resolveVisibleColumns(definition, draftConfig, defaultConfig);
  const activeFilters = resolveSavedViewFilters(definition, draftConfig.filters);
  const viewFilters = useMemo(
    () =>
      ({
        search: typeof activeFilters?.search === "string" ? activeFilters.search : "",
        filtersOpen: Boolean(activeFilters?.filtersOpen),
        selectedTeams: Array.isArray(activeFilters?.selectedTeams) ? activeFilters.selectedTeams as string[] : [],
        selectedRoles: Array.isArray(activeFilters?.selectedRoles) ? activeFilters.selectedRoles as string[] : [],
        selectedStatuses: Array.isArray(activeFilters?.selectedStatuses) ? activeFilters.selectedStatuses as string[] : [],
      }) satisfies UserFiltersValue,
    [activeFilters],
  );
  const viewSort = useMemo(
    () => ({
      key: (typeof draftConfig.sort?.key === "string" ? draftConfig.sort.key : "name") as SortKey,
      direction: (draftConfig.sort?.direction === "desc" ? "desc" : "asc") as SortDirection,
    }),
    [draftConfig.sort],
  );

  useEffect(() => {
    if (!ssoSettings) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSsoDraft({
      enabled: ssoSettings.enabled,
      issuer_url: ssoSettings.issuer_url ?? "",
      authorization_endpoint: ssoSettings.authorization_endpoint ?? "",
      token_endpoint: ssoSettings.token_endpoint ?? "",
      userinfo_endpoint: ssoSettings.userinfo_endpoint ?? "",
      jwks_uri: ssoSettings.jwks_uri ?? "",
      client_id: ssoSettings.client_id ?? "",
      client_secret: "",
      auto_provision_users: ssoSettings.auto_provision_users,
      default_role_id: ssoSettings.default_role_id ? String(ssoSettings.default_role_id) : "",
      default_team_id: ssoSettings.default_team_id ? String(ssoSettings.default_team_id) : "",
      email_claim: ssoSettings.email_claim || "email",
      first_name_claim: ssoSettings.first_name_claim ?? "given_name",
      last_name_claim: ssoSettings.last_name_claim ?? "family_name",
    });
  }, [ssoSettings]);

  const saveSsoSettings = async () => {
    await updateSsoSettings({
      enabled: ssoDraft.enabled,
      issuer_url: ssoDraft.issuer_url || null,
      authorization_endpoint: ssoDraft.authorization_endpoint || null,
      token_endpoint: ssoDraft.token_endpoint || null,
      userinfo_endpoint: ssoDraft.userinfo_endpoint || null,
      jwks_uri: ssoDraft.jwks_uri || null,
      client_id: ssoDraft.client_id || null,
      client_secret: ssoDraft.client_secret || null,
      auto_provision_users: ssoDraft.auto_provision_users,
      default_role_id: ssoDraft.default_role_id ? Number(ssoDraft.default_role_id) : null,
      default_team_id: ssoDraft.default_team_id ? Number(ssoDraft.default_team_id) : null,
      email_claim: ssoDraft.email_claim || "email",
      first_name_claim: ssoDraft.first_name_claim || null,
      last_name_claim: ssoDraft.last_name_claim || null,
    });
    setSsoDraft((current) => ({ ...current, client_secret: "" }));
  };

  const addDomain = async () => {
    const hostname = domainDraft.trim();
    if (!hostname) return;
    await createTenantDomain({ hostname, is_primary: tenantDomains.length === 0 });
    setDomainDraft("");
  };
  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <PageHeader
        title="User Management"
        description="Manage provisioned users, roles, access, and team membership."
        actions={
          <>
          <SavedViewSelector
            moduleKey="admin_users"
            views={views}
            selectedViewId={selectedViewId}
            onSelect={setSelectedViewId}
          />
          <Button onClick={openCreateModal}>
            <Plus />
            Add User
          </Button>
          </>
        }
      />

      <InlineSavedViewFilters
        filterFields={definition?.filterFields ?? []}
        filters={activeFilters}
        onChange={(nextFilters) =>
          setDraftConfig((current) => ({
            ...current,
            filters: {
              ...nextFilters,
              selectedTeams: Array.isArray(current.filters?.selectedTeams) ? current.filters.selectedTeams : [],
              selectedRoles: Array.isArray(current.filters?.selectedRoles) ? current.filters.selectedRoles : [],
              selectedStatuses: Array.isArray(current.filters?.selectedStatuses) ? current.filters.selectedStatuses : [],
            },
          }))
        }
      />

      <Card className="px-4 py-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md border border-neutral-800 bg-neutral-950">
              <ShieldCheck className="size-4 text-neutral-300" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-neutral-100">MFA policy</h2>
              <p className="text-xs text-neutral-500">Applies to local app MFA for manual CRM sign-in.</p>
            </div>
          </div>
          <Select
            value={mfaPolicy}
            disabled={isMfaPolicyLoading || isMfaPolicySaving}
            onValueChange={(value) => updateMfaPolicy(value as MfaPolicy)}
          >
            <SelectTrigger className="w-full md:w-60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">Do not require MFA</SelectItem>
              <SelectItem value="admins_only">Require for admins</SelectItem>
              <SelectItem value="all_users">Require for all users</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="px-4 py-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-md border border-neutral-800 bg-neutral-950">
                <Globe2 className="size-4 text-neutral-300" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-neutral-100">Custom domains</h2>
                <p className="text-xs text-neutral-500">Add the TXT record shown here before using tenant SSO.</p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={domainDraft}
                onChange={(event) => setDomainDraft(event.target.value)}
                placeholder="crm.example.com"
                disabled={isTenantDomainSaving}
              />
              <Button type="button" onClick={() => void addDomain()} disabled={isTenantDomainSaving || !domainDraft.trim()}>
                Add Domain
              </Button>
            </div>
          </div>

          <div className="grid gap-3">
            {tenantDomains.length ? tenantDomains.map((domain) => (
              <div key={domain.id} className="rounded-md border border-neutral-800 bg-neutral-950/50 p-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm text-neutral-100">{domain.hostname}</span>
                      <span className={domain.status === "verified" ? "rounded bg-emerald-950 px-2 py-0.5 text-xs text-emerald-300" : domain.status === "failed" ? "rounded bg-red-950 px-2 py-0.5 text-xs text-red-300" : "rounded bg-amber-950 px-2 py-0.5 text-xs text-amber-300"}>
                        {domain.status}
                      </span>
                      {domain.is_primary ? <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">primary</span> : null}
                    </div>
                    <div className="mt-2 grid gap-1 text-xs text-neutral-400">
                      <div>
                        TXT <span className="font-mono text-neutral-200">{domain.txt_record_name}</span> = <span className="font-mono text-neutral-200">{domain.txt_record_value}</span>
                      </div>
                      {domain.verified_at ? <div>Verified {formatDateTime(domain.verified_at)}</div> : null}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="secondary" onClick={() => void verifyTenantDomain(domain.id)} disabled={isTenantDomainSaving || domain.status === "verified"}>
                      Verify
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" title="Remove domain" onClick={() => void deleteTenantDomain(domain.id)} disabled={isTenantDomainSaving}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )) : (
              <div className="rounded-md border border-neutral-800 bg-neutral-950/50 p-3 text-sm text-neutral-400">
                {isTenantDomainsLoading ? "Loading domains..." : "No custom domains added."}
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card className="px-4 py-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-neutral-100">OIDC SSO</h2>
              <p className="text-xs text-neutral-500">Tenant sign-in through an external identity provider.</p>
            </div>
            <label className="flex items-center gap-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={ssoDraft.enabled}
                disabled={isSsoSettingsLoading || isSsoSettingsSaving}
                onChange={(event) => setSsoDraft((current) => ({ ...current, enabled: event.target.checked }))}
              />
              Enabled
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Field>
              <FieldLabel>Issuer URL</FieldLabel>
              <Input value={ssoDraft.issuer_url} onChange={(event) => setSsoDraft((current) => ({ ...current, issuer_url: event.target.value }))} placeholder="https://idp.example.com" />
            </Field>
            <Field>
              <FieldLabel>Client ID</FieldLabel>
              <Input value={ssoDraft.client_id} onChange={(event) => setSsoDraft((current) => ({ ...current, client_id: event.target.value }))} />
            </Field>
            <Field>
              <FieldLabel>Client Secret</FieldLabel>
              <Input
                type="password"
                value={ssoDraft.client_secret}
                onChange={(event) => setSsoDraft((current) => ({ ...current, client_secret: event.target.value }))}
                placeholder={ssoSettings?.has_client_secret ? "Stored secret" : ""}
              />
            </Field>
            <Field>
              <FieldLabel>Allowed Email Domains</FieldLabel>
              <Input value={ssoSettings?.allowed_email_domains.join(", ") ?? ""} readOnly placeholder="Verify a custom domain first" />
              <FieldDescription>Derived from verified custom domains.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Authorization Endpoint</FieldLabel>
              <Input value={ssoDraft.authorization_endpoint} onChange={(event) => setSsoDraft((current) => ({ ...current, authorization_endpoint: event.target.value }))} />
              <FieldDescription>Optional when discovery is available.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Token Endpoint</FieldLabel>
              <Input value={ssoDraft.token_endpoint} onChange={(event) => setSsoDraft((current) => ({ ...current, token_endpoint: event.target.value }))} />
              <FieldDescription>Optional when discovery is available.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>UserInfo Endpoint</FieldLabel>
              <Input value={ssoDraft.userinfo_endpoint} onChange={(event) => setSsoDraft((current) => ({ ...current, userinfo_endpoint: event.target.value }))} />
            </Field>
            <Field>
              <FieldLabel>JWKS URI</FieldLabel>
              <Input value={ssoDraft.jwks_uri} onChange={(event) => setSsoDraft((current) => ({ ...current, jwks_uri: event.target.value }))} />
              <FieldDescription>Optional when discovery is available.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Email Claim</FieldLabel>
              <Input value={ssoDraft.email_claim} onChange={(event) => setSsoDraft((current) => ({ ...current, email_claim: event.target.value }))} />
            </Field>
            <Field>
              <FieldLabel>First Name Claim</FieldLabel>
              <Input value={ssoDraft.first_name_claim} onChange={(event) => setSsoDraft((current) => ({ ...current, first_name_claim: event.target.value }))} />
            </Field>
            <Field>
              <FieldLabel>Last Name Claim</FieldLabel>
              <Input value={ssoDraft.last_name_claim} onChange={(event) => setSsoDraft((current) => ({ ...current, last_name_claim: event.target.value }))} />
            </Field>
            <Field>
              <FieldLabel>Default Role</FieldLabel>
              <Select value={ssoDraft.default_role_id || "__none__"} onValueChange={(value) => setSsoDraft((current) => ({ ...current, default_role_id: value === "__none__" ? "" : value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {roles.map((role) => <SelectItem key={role.id} value={String(role.id)}>{role.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Default Team</FieldLabel>
              <Select value={ssoDraft.default_team_id || "__none__"} onValueChange={(value) => setSsoDraft((current) => ({ ...current, default_team_id: value === "__none__" ? "" : value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {teams.map((team) => <SelectItem key={team.id} value={String(team.id)}>{team.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <label className="flex items-center gap-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={ssoDraft.auto_provision_users}
                onChange={(event) => setSsoDraft((current) => ({ ...current, auto_provision_users: event.target.checked }))}
              />
              Auto-provision users
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" variant="secondary" onClick={() => void testSsoSettings()} disabled={isSsoSettingsLoading || isSsoSettingsSaving || isSsoSettingsTesting}>
                {isSsoSettingsTesting ? "Testing..." : "Test Connection"}
              </Button>
              <Button type="button" onClick={() => void saveSsoSettings()} disabled={isSsoSettingsLoading || isSsoSettingsSaving || isSsoSettingsTesting}>
                Save SSO Settings
              </Button>
            </div>
          </div>

          <div className="grid gap-3 border-t border-neutral-800 pt-4 text-sm md:grid-cols-3">
            <div>
              <div className="text-xs uppercase text-neutral-500">Last test</div>
              <div className={ssoSettings?.last_test_result?.ok ? "mt-1 text-emerald-300" : "mt-1 text-amber-300"}>
                {ssoSettings?.last_test_result
                  ? `${ssoSettings.last_test_result.ok ? "Passed" : "Failed"} · ${formatDateTime(ssoSettings.last_test_result.checked_at)}`
                  : "Not tested"}
              </div>
              {ssoSettings?.last_test_result?.message && (
                <div className="mt-1 text-xs text-neutral-400">{ssoSettings.last_test_result.message}</div>
              )}
              {ssoSettings?.last_test_result?.errors?.map((error) => (
                <div key={error} className="mt-1 text-xs text-red-300">{error}</div>
              ))}
            </div>
            <div>
              <div className="text-xs uppercase text-neutral-500">Last SSO login</div>
              <div className="mt-1 text-neutral-200">
                {ssoSettings?.last_successful_login_at ? formatDateTime(ssoSettings.last_successful_login_at) : "Never"}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase text-neutral-500">Last failure</div>
              <div className="mt-1 text-neutral-200">
                {ssoSettings?.last_failed_login_reason || "None recorded"}
              </div>
            </div>
          </div>
        </div>
      </Card>

      <UserManagementTable
        currentUserId={currentUserId}
        optionsData={optionsData}
        onEdit={openEditModal}
        visibleColumns={visibleColumns}
        stateKey={selectedViewId}
        initialFilters={viewFilters}
        initialSortKey={viewSort.key}
        initialSortDirection={viewSort.direction}
        allViewConditions={Array.isArray(activeFilters.all_conditions) ? activeFilters.all_conditions : []}
        anyViewConditions={Array.isArray(activeFilters.any_conditions) ? activeFilters.any_conditions : []}
        onStateChange={({ filters, sortKey, sortDirection }) =>
          setDraftConfig((current) => {
            const nextSort = { key: sortKey, direction: sortDirection };
            const nextFilters = {
              ...filters,
              conditions: [],
              all_conditions: Array.isArray(activeFilters.all_conditions) ? activeFilters.all_conditions : [],
              any_conditions: Array.isArray(activeFilters.any_conditions) ? activeFilters.any_conditions : [],
            };
            const sameFilters =
              JSON.stringify(current.filters ?? {}) === JSON.stringify(nextFilters);
            const sameSort =
              JSON.stringify(current.sort ?? null) === JSON.stringify(nextSort);
            if (sameFilters && sameSort) {
              return current;
            }
            return {
              ...current,
              filters: nextFilters,
              sort: nextSort,
            };
          })
        }
      />

      <CreateUserDialog
        open={isCreateOpen}
        roles={roles}
        teams={teams}
        onClose={closeCreateModal}
        onCreate={createUser}
      />

      {editUserData && (
        <EditUserDialog
          key={editUserData.id}
          open={isEditOpen}
          user={editUserData}
          roles={roles}
          teams={teams}
          currentUserId={currentUserId}
          onClose={closeEditModal}
          onSave={async (id, form) => {
            await updateUser(id, form);
            closeEditModal();
          }}
          onResetMfa={async (id) => {
            await resetUserMfa(id);
            closeEditModal();
          }}
          isResettingMfa={isResettingUserMfa}
        />
      )}
    </div>
  );
}
