"use client";

import {
  Check,
  Copy,
  Globe2,
  KeyRound,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { RecordTabs } from "@/components/ui/RecordTabs";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  UserManagementTable,
  type SortDirection,
  type SortKey,
} from "@/components/users/userManagementTable";
import CreateUserDialog from "@/components/users/createUserDialog";
import EditUserDialog from "@/components/users/editUserDialog";
import {
  useUserManagement,
  type MfaPolicy,
  type SsoSettings,
} from "@/hooks/admin/useUserManagement";
import { useSavedViews } from "@/hooks/useSavedViews";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { formatDateTime } from "@/lib/datetime";
import {
  buildModuleViewDefinition,
  MODULE_VIEW_DEFAULTS,
  resolveSavedViewFilters,
  resolveVisibleColumns,
} from "@/lib/moduleViewConfigs";
import { canonicalSavedViewFiltersKey } from "@/lib/savedViewQuery";
import type { UserFiltersValue } from "@/components/users/userFilters";
import { useEffect, useMemo, useRef, useState } from "react";

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

const ADMIN_TABS = [
  "users",
  "authentication",
  "domains",
  "provisioning",
] as const;
type AdminTab = (typeof ADMIN_TABS)[number];

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

function draftFromSsoSettings(settings: SsoSettings): SsoDraft {
  return {
    enabled: settings.enabled,
    issuer_url: settings.issuer_url ?? "",
    authorization_endpoint: settings.authorization_endpoint ?? "",
    token_endpoint: settings.token_endpoint ?? "",
    userinfo_endpoint: settings.userinfo_endpoint ?? "",
    jwks_uri: settings.jwks_uri ?? "",
    client_id: settings.client_id ?? "",
    client_secret: "",
    auto_provision_users: settings.auto_provision_users,
    default_role_id: settings.default_role_id
      ? String(settings.default_role_id)
      : "",
    default_team_id: settings.default_team_id
      ? String(settings.default_team_id)
      : "",
    email_claim: settings.email_claim || "email",
    first_name_claim: settings.first_name_claim ?? "given_name",
    last_name_claim: settings.last_name_claim ?? "family_name",
  };
}

export default function UserManagementPage() {
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const activeTab: AdminTab = ADMIN_TABS.includes(requestedTab as AdminTab)
    ? (requestedTab as AdminTab)
    : "users";
  const { fields: moduleFields } = useModuleFieldConfigs("admin_users");
  const definition = useMemo(
    () => buildModuleViewDefinition("admin_users", [], moduleFields),
    [moduleFields],
  );
  const defaultConfig =
    definition?.defaultConfig ?? MODULE_VIEW_DEFAULTS.admin_users;
  const {
    currentUserId,
    editUserData,
    isEditOpen,
    isCreateOpen,
    optionsData,
    mfaPolicy,
    passwordPolicy,
    isPasswordPolicyLoading,
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
    bulkUpdateUsers,
    updateMfaPolicy,
    resetUserMfa,
    isResettingUserMfa,
    updateSsoSettings,
    testSsoSettings,
    createTenantDomain,
    verifyTenantDomain,
    deleteTenantDomain,
  } = useUserManagement(activeTab);
  const [ssoDraft, setSsoDraft] = useState<SsoDraft>(emptySsoDraft);
  const [isSsoDraftDirty, setIsSsoDraftDirty] = useState(false);
  const isSsoDraftDirtyRef = useRef(false);
  const [domainDraft, setDomainDraft] = useState("");
  const [domainToDelete, setDomainToDelete] = useState<{
    id: number;
    hostname: string;
  } | null>(null);
  const {
    views,
    selectedViewId,
    setSelectedViewId,
    draftConfig,
    setDraftConfig,
  } = useSavedViews("admin_users", defaultConfig);
  const visibleColumns = resolveVisibleColumns(
    definition,
    draftConfig,
    defaultConfig,
  );
  const activeFilters = resolveSavedViewFilters(
    definition,
    draftConfig.filters,
  );
  const viewFilters = useMemo(
    () =>
      ({
        search:
          typeof activeFilters?.search === "string" ? activeFilters.search : "",
        filtersOpen: Boolean(activeFilters?.filtersOpen),
        selectedTeams: Array.isArray(activeFilters?.selectedTeams)
          ? (activeFilters.selectedTeams as string[])
          : [],
        selectedRoles: Array.isArray(activeFilters?.selectedRoles)
          ? (activeFilters.selectedRoles as string[])
          : [],
        selectedStatuses: Array.isArray(activeFilters?.selectedStatuses)
          ? (activeFilters.selectedStatuses as string[])
          : [],
      }) satisfies UserFiltersValue,
    [activeFilters],
  );
  const viewSort = useMemo(
    () => ({
      key: (typeof draftConfig.sort?.key === "string"
        ? draftConfig.sort.key
        : "name") as SortKey,
      direction: (draftConfig.sort?.direction === "desc"
        ? "desc"
        : "asc") as SortDirection,
    }),
    [draftConfig.sort],
  );
  useUnsavedChangesGuard(isSsoDraftDirty, isSsoSettingsSaving);

  useEffect(() => {
    if (!ssoSettings) return;
    if (isSsoDraftDirtyRef.current) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSsoDraft(draftFromSsoSettings(ssoSettings));
  }, [ssoSettings]);

  const updateSsoDraftField = <Key extends keyof SsoDraft>(
    field: Key,
    value: SsoDraft[Key],
  ) => {
    isSsoDraftDirtyRef.current = true;
    setIsSsoDraftDirty(true);
    setSsoDraft((current) => ({ ...current, [field]: value }));
  };

  const resetSsoDraft = () => {
    if (!ssoSettings) return;
    isSsoDraftDirtyRef.current = false;
    setIsSsoDraftDirty(false);
    setSsoDraft(draftFromSsoSettings(ssoSettings));
  };

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
      default_role_id: ssoDraft.default_role_id
        ? Number(ssoDraft.default_role_id)
        : null,
      default_team_id: ssoDraft.default_team_id
        ? Number(ssoDraft.default_team_id)
        : null,
      email_claim: ssoDraft.email_claim || "email",
      first_name_claim: ssoDraft.first_name_claim || null,
      last_name_claim: ssoDraft.last_name_claim || null,
    });
    isSsoDraftDirtyRef.current = false;
    setIsSsoDraftDirty(false);
    setSsoDraft((current) => ({ ...current, client_secret: "" }));
  };

  const addDomain = async () => {
    const hostname = domainDraft.trim();
    if (!hostname) return;
    try {
      await createTenantDomain({
        hostname,
        is_primary: tenantDomains.length === 0,
      });
      setDomainDraft("");
    } catch {
      // The mutation presents a safe user-facing error and preserves the input.
    }
  };

  const copyDnsValue = async (value: string | null, label: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied.`);
    } catch {
      toast.error(`${label} could not be copied.`);
    }
  };

  const confirmDeleteDomain = async () => {
    if (!domainToDelete) return;
    try {
      await deleteTenantDomain(domainToDelete.id);
      setDomainToDelete(null);
    } catch {
      // Keep the confirmation open so the administrator can retry or cancel.
    }
  };

  const verifyDomain = async (domainId: number) => {
    try {
      await verifyTenantDomain(domainId);
    } catch {
      // The mutation refreshes the failed status and presents safe guidance.
    }
  };
  return (
    <div className="flex flex-col gap-6 text-copy-primary">
      <PageHeader
        title="User Management"
        description="Manage provisioned users, roles, access, and team membership."
        actions={
          activeTab === "users" ? (
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
          ) : undefined
        }
      />

      <RecordTabs
        urlParam="tab"
        defaultTabId="users"
        renderPanel={false}
        tabs={[
          { id: "users", label: "Users", content: null },
          { id: "authentication", label: "Authentication", content: null },
          { id: "domains", label: "Domains", content: null },
          { id: "provisioning", label: "Provisioning", content: null },
        ]}
      />

      {activeTab === "users" ? (
        <InlineSavedViewFilters
          filterFields={definition?.filterFields ?? []}
          filters={activeFilters}
          onChange={(nextFilters) =>
            setDraftConfig((current) => ({
              ...current,
              filters: {
                ...nextFilters,
                selectedTeams: Array.isArray(current.filters?.selectedTeams)
                  ? current.filters.selectedTeams
                  : [],
                selectedRoles: Array.isArray(current.filters?.selectedRoles)
                  ? current.filters.selectedRoles
                  : [],
                selectedStatuses: Array.isArray(
                  current.filters?.selectedStatuses,
                )
                  ? current.filters.selectedStatuses
                  : [],
              },
            }))
          }
        />
      ) : null}

      {activeTab === "authentication" ? (
        <Card className="px-4 py-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-control border border-line-default bg-surface-muted">
                <ShieldCheck className="size-4 text-copy-secondary" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-copy-primary">
                  MFA policy
                </h2>
                <p className="text-xs text-copy-muted">
                  Applies to local app MFA for manual CRM sign-in.
                </p>
              </div>
            </div>
            <Select
              value={mfaPolicy}
              disabled={isMfaPolicyLoading || isMfaPolicySaving}
              onValueChange={(value) => updateMfaPolicy(value as MfaPolicy)}
            >
              <SelectTrigger className="w-full md:w-60" aria-label="MFA policy">
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
      ) : null}

      {activeTab === "authentication" ? (
        <Card className="px-4 py-4">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-control border border-line-default bg-surface-muted">
                <KeyRound className="size-4 text-copy-secondary" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold text-copy-primary">
                    Password policy
                  </h2>
                  <span className="rounded-control bg-state-info-muted px-2 py-0.5 text-xs text-state-info">
                    Platform enforced
                  </span>
                </div>
                <p className="text-xs text-copy-muted">
                  Applied whenever a CRM or client password is created or reset.
                </p>
              </div>
            </div>

            {isPasswordPolicyLoading ? (
              <div className="rounded-control border border-line-default bg-surface-muted p-3 text-sm text-copy-muted">
                Loading password requirements…
              </div>
            ) : passwordPolicy ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {passwordPolicy.requirements.map((requirement) => (
                  <div
                    key={requirement}
                    className="flex items-start gap-2 rounded-control border border-line-default bg-surface-muted px-3 py-2 text-sm text-copy-secondary"
                  >
                    <Check
                      className="mt-0.5 size-4 shrink-0 text-state-success"
                      aria-hidden="true"
                    />
                    <span>{requirement}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div
                className="rounded-control border border-state-danger/40 bg-state-danger-muted p-3 text-sm text-state-danger"
                role="alert"
              >
                Password requirements could not be loaded. Refresh this page to
                try again.
              </div>
            )}
          </div>
        </Card>
      ) : null}

      {activeTab === "domains" ? (
        <Card className="px-4 py-4">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-control border border-line-default bg-surface-muted">
                  <Globe2 className="size-4 text-copy-secondary" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-copy-primary">
                    Custom domains
                  </h2>
                  <p className="text-xs text-copy-muted">
                    Verify ownership with the TXT record shown on each domain
                    card before using tenant SSO.
                  </p>
                </div>
              </div>
              <form
                className="flex w-full flex-col gap-2 sm:flex-row lg:max-w-lg"
                onSubmit={(event) => {
                  event.preventDefault();
                  void addDomain();
                }}
              >
                <label className="min-w-0 flex-1">
                  <span className="sr-only">Custom domain</span>
                  <Input
                    value={domainDraft}
                    onChange={(event) => setDomainDraft(event.target.value)}
                    placeholder="crm.example.com"
                    autoComplete="url"
                    disabled={isTenantDomainSaving}
                  />
                </label>
                <Button
                  type="submit"
                  disabled={isTenantDomainSaving || !domainDraft.trim()}
                >
                  Add Domain
                </Button>
              </form>
            </div>

            {isTenantDomainsLoading ? (
              <div
                className="rounded-control border border-line-default bg-surface-muted p-4 text-sm text-copy-muted"
                aria-live="polite"
              >
                Loading custom domains…
              </div>
            ) : tenantDomains.length ? (
              <div className="grid gap-3 xl:grid-cols-2">
                {tenantDomains.map((domain) => (
                  <section
                    key={domain.id}
                    className="flex min-w-0 flex-col gap-4 rounded-control border border-line-default bg-surface-muted p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <h3 className="break-all font-mono text-sm font-semibold text-copy-primary">
                          {domain.hostname}
                        </h3>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span
                            className={
                              domain.status === "verified"
                                ? "rounded-control bg-state-success-subtle px-2 py-0.5 text-xs font-medium text-state-success"
                                : domain.status === "failed"
                                  ? "rounded-control bg-state-danger-subtle px-2 py-0.5 text-xs font-medium text-state-danger"
                                  : "rounded-control bg-state-warning-subtle px-2 py-0.5 text-xs font-medium text-state-warning"
                            }
                          >
                            {domain.status.charAt(0).toUpperCase() +
                              domain.status.slice(1)}
                          </span>
                          {domain.is_primary ? (
                            <span className="rounded-control bg-surface-hover px-2 py-0.5 text-xs text-copy-secondary">
                              Primary
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => void verifyDomain(domain.id)}
                          disabled={
                            isTenantDomainSaving || domain.status === "verified"
                          }
                        >
                          Verify
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          title="Remove domain"
                          aria-label={`Remove ${domain.hostname}`}
                          onClick={() =>
                            setDomainToDelete({
                              id: domain.id,
                              hostname: domain.hostname,
                            })
                          }
                          disabled={isTenantDomainSaving}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>

                    <dl className="grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-xs uppercase tracking-wide text-copy-muted">
                          Record type
                        </dt>
                        <dd className="mt-1 font-mono text-copy-primary">
                          TXT
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-wide text-copy-muted">
                          Last checked
                        </dt>
                        <dd className="mt-1 text-copy-secondary">
                          {domain.last_checked_at
                            ? formatDateTime(domain.last_checked_at)
                            : "Never"}
                        </dd>
                      </div>
                      <div className="min-w-0 sm:col-span-2">
                        <dt className="text-xs uppercase tracking-wide text-copy-muted">
                          Host / name
                        </dt>
                        <dd className="mt-1 flex min-w-0 items-start gap-2">
                          <code className="min-w-0 flex-1 break-all text-copy-secondary">
                            {domain.txt_record_name}
                          </code>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Copy DNS host for ${domain.hostname}`}
                            onClick={() =>
                              void copyDnsValue(
                                domain.txt_record_name,
                                "DNS host",
                              )
                            }
                          >
                            <Copy className="size-4" />
                          </Button>
                        </dd>
                      </div>
                      <div className="min-w-0 sm:col-span-2">
                        <dt className="text-xs uppercase tracking-wide text-copy-muted">
                          Expected value
                        </dt>
                        <dd className="mt-1 flex min-w-0 items-start gap-2">
                          <code className="min-w-0 flex-1 break-all text-copy-secondary">
                            {domain.txt_record_value}
                          </code>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Copy DNS value for ${domain.hostname}`}
                            onClick={() =>
                              void copyDnsValue(
                                domain.txt_record_value,
                                "DNS value",
                              )
                            }
                          >
                            <Copy className="size-4" />
                          </Button>
                        </dd>
                      </div>
                    </dl>

                    {domain.status === "failed" ? (
                      <p className="text-xs text-state-danger" role="status">
                        DNS proof was not found. Confirm the TXT host and value,
                        allow for propagation, then verify again.
                      </p>
                    ) : domain.verified_at ? (
                      <p className="text-xs text-copy-muted">
                        Verified {formatDateTime(domain.verified_at)}
                      </p>
                    ) : null}
                  </section>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={Globe2}
                title="No custom domains yet"
                description="Add a CRM hostname to generate the TXT record required for ownership verification."
              />
            )}
          </div>
        </Card>
      ) : null}

      {activeTab === "authentication" || activeTab === "provisioning" ? (
        <Card className="px-4 py-4">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-copy-primary">
                  {activeTab === "authentication"
                    ? "OIDC SSO"
                    : "User provisioning"}
                </h2>
                <p className="text-xs text-copy-muted">
                  {activeTab === "authentication"
                    ? "Tenant sign-in through an external identity provider."
                    : "Choose how verified identities map to users, roles, and teams."}
                </p>
              </div>
              {activeTab === "authentication" ? (
                <label className="flex items-center gap-2 text-sm text-copy-secondary">
                  <input
                    type="checkbox"
                    checked={ssoDraft.enabled}
                    disabled={isSsoSettingsLoading || isSsoSettingsSaving}
                    onChange={(event) =>
                      updateSsoDraftField("enabled", event.target.checked)
                    }
                  />
                  Enabled
                </label>
              ) : null}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {activeTab === "authentication" ? (
                <>
                  <Field>
                    <FieldLabel>Issuer URL</FieldLabel>
                    <Input
                      value={ssoDraft.issuer_url}
                      onChange={(event) =>
                        updateSsoDraftField("issuer_url", event.target.value)
                      }
                      placeholder="https://idp.example.com"
                    />
                  </Field>
                  <Field>
                    <FieldLabel>Client ID</FieldLabel>
                    <Input
                      value={ssoDraft.client_id}
                      onChange={(event) =>
                        updateSsoDraftField("client_id", event.target.value)
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel>Client Secret</FieldLabel>
                    <Input
                      type="password"
                      value={ssoDraft.client_secret}
                      onChange={(event) =>
                        updateSsoDraftField("client_secret", event.target.value)
                      }
                      placeholder={
                        ssoSettings?.has_client_secret ? "Stored secret" : ""
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel>Verified Login Domains</FieldLabel>
                    <Input
                      value={
                        ssoSettings?.allowed_email_domains.join(", ") ?? ""
                      }
                      readOnly
                      placeholder="Verify a custom domain first"
                    />
                    <FieldDescription>
                      Used to route SSO to this tenant. SSO users are matched
                      inside this tenant after the provider verifies them.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel>Authorization Endpoint</FieldLabel>
                    <Input
                      value={ssoDraft.authorization_endpoint}
                      onChange={(event) =>
                        updateSsoDraftField(
                          "authorization_endpoint",
                          event.target.value,
                        )
                      }
                    />
                    <FieldDescription>
                      Optional when discovery is available.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel>Token Endpoint</FieldLabel>
                    <Input
                      value={ssoDraft.token_endpoint}
                      onChange={(event) =>
                        updateSsoDraftField(
                          "token_endpoint",
                          event.target.value,
                        )
                      }
                    />
                    <FieldDescription>
                      Optional when discovery is available.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel>UserInfo Endpoint</FieldLabel>
                    <Input
                      value={ssoDraft.userinfo_endpoint}
                      onChange={(event) =>
                        updateSsoDraftField(
                          "userinfo_endpoint",
                          event.target.value,
                        )
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel>JWKS URI</FieldLabel>
                    <Input
                      value={ssoDraft.jwks_uri}
                      onChange={(event) =>
                        updateSsoDraftField("jwks_uri", event.target.value)
                      }
                    />
                    <FieldDescription>
                      Optional when discovery is available.
                    </FieldDescription>
                  </Field>
                </>
              ) : null}
              {activeTab === "provisioning" ? (
                <>
                  <Field>
                    <FieldLabel>Email Claim</FieldLabel>
                    <Input
                      value={ssoDraft.email_claim}
                      onChange={(event) =>
                        updateSsoDraftField("email_claim", event.target.value)
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel>First Name Claim</FieldLabel>
                    <Input
                      value={ssoDraft.first_name_claim}
                      onChange={(event) =>
                        updateSsoDraftField(
                          "first_name_claim",
                          event.target.value,
                        )
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel>Last Name Claim</FieldLabel>
                    <Input
                      value={ssoDraft.last_name_claim}
                      onChange={(event) =>
                        updateSsoDraftField(
                          "last_name_claim",
                          event.target.value,
                        )
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel>Default Role</FieldLabel>
                    <Select
                      value={ssoDraft.default_role_id || "__none__"}
                      onValueChange={(value) =>
                        updateSsoDraftField(
                          "default_role_id",
                          value === "__none__" ? "" : value,
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {roles.map((role) => (
                          <SelectItem key={role.id} value={String(role.id)}>
                            {role.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel>Default Team</FieldLabel>
                    <Select
                      value={ssoDraft.default_team_id || "__none__"}
                      onValueChange={(value) =>
                        updateSsoDraftField(
                          "default_team_id",
                          value === "__none__" ? "" : value,
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {teams.map((team) => (
                          <SelectItem key={team.id} value={String(team.id)}>
                            {team.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              {activeTab === "provisioning" ? (
                <label className="flex items-center gap-2 text-sm text-copy-secondary">
                  <input
                    type="checkbox"
                    checked={ssoDraft.auto_provision_users}
                    onChange={(event) =>
                      updateSsoDraftField(
                        "auto_provision_users",
                        event.target.checked,
                      )
                    }
                  />
                  Auto-provision users
                </label>
              ) : (
                <span />
              )}
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={resetSsoDraft}
                  disabled={
                    !isSsoDraftDirty ||
                    isSsoSettingsLoading ||
                    isSsoSettingsSaving ||
                    isSsoSettingsTesting
                  }
                >
                  Discard Changes
                </Button>
                {activeTab === "authentication" ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void testSsoSettings()}
                    disabled={
                      isSsoSettingsLoading ||
                      isSsoSettingsSaving ||
                      isSsoSettingsTesting ||
                      isSsoDraftDirty
                    }
                    title={
                      isSsoDraftDirty
                        ? "Save changes before testing the connection"
                        : undefined
                    }
                  >
                    {isSsoSettingsTesting ? "Testing..." : "Test Connection"}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  onClick={() => void saveSsoSettings()}
                  disabled={
                    isSsoSettingsLoading ||
                    isSsoSettingsSaving ||
                    isSsoSettingsTesting
                  }
                >
                  Save SSO Settings
                </Button>
              </div>
            </div>

            {activeTab === "authentication" ? (
              <div className="grid gap-3 border-t border-line-default pt-4 text-sm md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <div className="text-xs uppercase text-copy-muted">
                    Last successful test
                  </div>
                  <div className="mt-1 text-state-success">
                    {ssoSettings?.last_successful_test
                      ? formatDateTime(
                          ssoSettings.last_successful_test.checked_at,
                        )
                      : "None recorded"}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase text-copy-muted">
                    Last failed test
                  </div>
                  <div className="mt-1 text-state-warning">
                    {ssoSettings?.last_failed_test
                      ? formatDateTime(ssoSettings.last_failed_test.checked_at)
                      : "None recorded"}
                  </div>
                  {ssoSettings?.last_failed_test ? (
                    <>
                      <p className="mt-1 text-xs text-copy-muted">
                        Connection failed. Review the provider settings and try
                        again.
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => void testSsoSettings()}
                          disabled={isSsoSettingsTesting || isSsoDraftDirty}
                          title={
                            isSsoDraftDirty
                              ? "Save changes before retrying the connection"
                              : undefined
                          }
                        >
                          {isSsoSettingsTesting ? "Testing…" : "Retry"}
                        </Button>
                        <details className="text-xs text-copy-muted">
                          <summary className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                            View technical details
                          </summary>
                          <div className="mt-2 max-w-sm space-y-1 rounded-control border border-line-default bg-surface-muted p-2">
                            <p className="break-words">
                              {ssoSettings.last_failed_test.message}
                            </p>
                            {ssoSettings.last_failed_test.errors.map(
                              (error) => (
                                <p key={error} className="break-words">
                                  {error}
                                </p>
                              ),
                            )}
                          </div>
                        </details>
                      </div>
                    </>
                  ) : null}
                </div>
                <div>
                  <div className="text-xs uppercase text-copy-muted">
                    Last successful login
                  </div>
                  <div className="mt-1 text-copy-secondary">
                    {ssoSettings?.last_successful_login_at
                      ? formatDateTime(ssoSettings.last_successful_login_at)
                      : "Never"}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase text-copy-muted">
                    Last failed login
                  </div>
                  <div className="mt-1 text-copy-secondary">
                    {ssoSettings?.last_failed_login_reason
                      ? "A recent SSO sign-in failed."
                      : "None recorded"}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {activeTab === "users" ? (
        <UserManagementTable
          currentUserId={currentUserId}
          optionsData={optionsData}
          onEdit={openEditModal}
          onBulkUpdate={bulkUpdateUsers}
          visibleColumns={visibleColumns}
          stateKey={selectedViewId}
          initialFilters={viewFilters}
          initialSortKey={viewSort.key}
          initialSortDirection={viewSort.direction}
          allViewConditions={
            Array.isArray(activeFilters.all_conditions)
              ? activeFilters.all_conditions
              : []
          }
          anyViewConditions={
            Array.isArray(activeFilters.any_conditions)
              ? activeFilters.any_conditions
              : []
          }
          onStateChange={({ filters, sortKey, sortDirection }) =>
            setDraftConfig((current) => {
              const nextSort = { key: sortKey, direction: sortDirection };
              const nextFilters = {
                ...filters,
                conditions: [],
                all_conditions: Array.isArray(activeFilters.all_conditions)
                  ? activeFilters.all_conditions
                  : [],
                any_conditions: Array.isArray(activeFilters.any_conditions)
                  ? activeFilters.any_conditions
                  : [],
              };
              const sameFilters =
                canonicalSavedViewFiltersKey(current.filters ?? {}) ===
                canonicalSavedViewFiltersKey(nextFilters);
              const sameSort =
                JSON.stringify(current.sort ?? null) ===
                JSON.stringify(nextSort);
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
      ) : null}

      <Dialog
        open={domainToDelete !== null}
        onClose={() => {
          if (!isTenantDomainSaving) setDomainToDelete(null);
        }}
      >
        <DialogBackdrop />
        <div className="fixed inset-0 z-[30] flex items-center justify-center p-4">
          <DialogPanel size="sm">
            <DialogHeader>
              <DialogTitle>Remove custom domain?</DialogTitle>
            </DialogHeader>
            <DialogDescription className="mt-2 text-copy-muted">
              Removing <strong>{domainToDelete?.hostname}</strong> disables its
              tenant routing and may interrupt SSO sign-in from that hostname.
            </DialogDescription>
            <DialogFooter className="mt-5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDomainToDelete(null)}
                disabled={isTenantDomainSaving}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void confirmDeleteDomain()}
                disabled={isTenantDomainSaving}
              >
                {isTenantDomainSaving ? "Removing…" : "Remove domain"}
              </Button>
            </DialogFooter>
          </DialogPanel>
        </div>
      </Dialog>

      <CreateUserDialog
        open={isCreateOpen}
        roles={roles}
        teams={teams}
        onClose={closeCreateModal}
        onCreate={createUser}
      />

      {editUserData && (
        <EditUserDialog
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
