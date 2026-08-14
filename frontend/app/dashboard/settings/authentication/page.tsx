"use client";

import { Check, KeyRound, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardFooter } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/checkbox";
import { PageShell } from "@/components/ui/PageShell";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuthenticationSettings } from "@/hooks/admin/useIdentitySettings";
import { useSsoDraft } from "@/hooks/admin/useSsoDraft";
import type { MfaPolicy } from "@/hooks/admin/useUserManagement";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { formatDateTime } from "@/lib/datetime";

export default function AuthenticationSettingsPage() {
  const settings = useAuthenticationSettings();
  const draft = useSsoDraft(settings.ssoSettings);
  useUnsavedChangesGuard(draft.isDirty, settings.isSaving);

  async function save() {
    try {
      await settings.updateSsoSettings({
        enabled: draft.draft.enabled,
        issuer_url: draft.draft.issuer_url || null,
        authorization_endpoint: draft.draft.authorization_endpoint || null,
        token_endpoint: draft.draft.token_endpoint || null,
        userinfo_endpoint: draft.draft.userinfo_endpoint || null,
        jwks_uri: draft.draft.jwks_uri || null,
        client_id: draft.draft.client_id || null,
        ...(draft.draft.client_secret ? { client_secret: draft.draft.client_secret } : {}),
      });
      draft.markSaved();
    } catch {
      // The mutation presents a safe error and the draft remains dirty.
    }
  }

  return (
    <PageShell variant="settings" title="Authentication" description="Set the MFA policy and connect an external identity provider.">
      <Card className="px-4 py-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          {/* This control saves on change; the SSO card below commits through its own
              footer. Two commit models on one page is fine — leaving the operator to
              guess which half has already saved is not, so each one says so (§7.4). */}
          <div className="flex items-center gap-3"><ShieldCheck className="size-4 text-copy-secondary" /><div><h2 className="text-sm font-semibold">MFA policy</h2><p className="text-xs text-copy-muted">Applies to manual CRM sign-in. Saves as soon as you change it.</p></div></div>
          <Select value={settings.mfaPolicy} disabled={settings.isLoading || settings.isSaving} onValueChange={(value) => settings.updateMfaPolicy(value as MfaPolicy)}><SelectTrigger className="w-full md:w-60" aria-label="MFA policy"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="off">Do not require MFA</SelectItem><SelectItem value="admins_only">Require for admins</SelectItem><SelectItem value="all_users">Require for all users</SelectItem></SelectContent></Select>
        </div>
      </Card>

      <Card className="px-4 py-4">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3"><KeyRound className="size-4 text-copy-secondary" /><div><h2 className="text-sm font-semibold">Password policy</h2><p className="text-xs text-copy-muted">Platform-enforced password requirements.</p></div></div>
          {settings.isPasswordPolicyLoading ? <p className="text-sm text-copy-muted" aria-live="polite">Loading password requirements…</p> : settings.passwordPolicy ? <div className="grid gap-2 sm:grid-cols-2">{settings.passwordPolicy.requirements.map((requirement) => <div key={requirement} className="flex gap-2 rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-3 py-2 text-sm text-copy-secondary"><Check className="mt-0.5 size-4 shrink-0 text-state-success" /><span>{requirement}</span></div>)}</div> : <p role="alert" className="text-sm text-state-danger">Password requirements could not be loaded.</p>}
        </div>
      </Card>

      <Card className="px-4 py-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-sm font-semibold">OIDC SSO</h2><p className="text-xs text-copy-muted">Tenant sign-in through an external identity provider.</p></div><label className="flex items-center gap-2 text-sm"><Checkbox checked={draft.draft.enabled} disabled={settings.isLoading || settings.isSaving} onCheckedChange={(checked) => draft.update("enabled", checked === true)} />Enabled</label></div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field><FieldLabel>Issuer URL</FieldLabel><Input value={draft.draft.issuer_url} onChange={(event) => draft.update("issuer_url", event.target.value)} placeholder="https://idp.example.com" /></Field>
            <Field><FieldLabel>Client ID</FieldLabel><Input value={draft.draft.client_id} onChange={(event) => draft.update("client_id", event.target.value)} /></Field>
            <Field><FieldLabel>Client Secret</FieldLabel><Input type="password" value={draft.draft.client_secret} onChange={(event) => draft.update("client_secret", event.target.value)} placeholder={settings.ssoSettings?.has_client_secret ? "Stored secret" : ""} /><FieldDescription>Leave blank to keep the stored secret.</FieldDescription></Field>
            <Field><FieldLabel>Verified login domains</FieldLabel><Input value={settings.ssoSettings?.allowed_email_domains.join(", ") ?? ""} readOnly placeholder="Verify a custom domain first" /></Field>
            <Field><FieldLabel>Authorization endpoint</FieldLabel><Input value={draft.draft.authorization_endpoint} onChange={(event) => draft.update("authorization_endpoint", event.target.value)} /><FieldDescription>Optional when discovery is available.</FieldDescription></Field>
            <Field><FieldLabel>Token endpoint</FieldLabel><Input value={draft.draft.token_endpoint} onChange={(event) => draft.update("token_endpoint", event.target.value)} /></Field>
            <Field><FieldLabel>UserInfo endpoint</FieldLabel><Input value={draft.draft.userinfo_endpoint} onChange={(event) => draft.update("userinfo_endpoint", event.target.value)} /></Field>
            <Field><FieldLabel>JWKS URI</FieldLabel><Input value={draft.draft.jwks_uri} onChange={(event) => draft.update("jwks_uri", event.target.value)} /></Field>
          </div>
          <div className="grid gap-3 border-t border-line-default pt-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Status label="Last successful test" value={settings.ssoSettings?.last_successful_test ? formatDateTime(settings.ssoSettings.last_successful_test.checked_at) : "None recorded"} />
            <Status label="Last failed test" value={settings.ssoSettings?.last_failed_test ? formatDateTime(settings.ssoSettings.last_failed_test.checked_at) : "None recorded"} />
            <Status label="Last successful login" value={settings.ssoSettings?.last_successful_login_at ? formatDateTime(settings.ssoSettings.last_successful_login_at) : "Never"} />
            <Status label="Last failed login" value={settings.ssoSettings?.last_failed_login_reason ? "A recent sign-in failed" : "None recorded"} />
          </div>
          {settings.ssoSettings?.last_failed_test ? (
            <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-line-default bg-surface-muted p-3 text-sm sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-copy-secondary">Connection failed. Review the provider settings and try again.</p>
                <details className="mt-2 text-xs text-copy-muted">
                  <summary className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">View technical details</summary>
                  <div className="mt-2 space-y-1"><p className="break-words">{settings.ssoSettings.last_failed_test.message}</p>{settings.ssoSettings.last_failed_test.errors.map((error) => <p key={error} className="break-words">{error}</p>)}</div>
                </details>
              </div>
              <Button variant="secondary" size="sm" onClick={() => void settings.testSsoSettings().catch(() => undefined)} disabled={settings.isTesting || draft.isDirty}>{settings.isTesting ? "Testing…" : "Retry"}</Button>
            </div>
          ) : null}
        </div>
        <CardFooter className="sticky bottom-0 z-10 mt-4 flex flex-col gap-2 bg-surface/95 backdrop-blur sm:flex-row sm:items-center sm:justify-end">
          <span className="mr-auto text-sm text-copy-muted" aria-live="polite">{draft.isDirty ? "You have unsaved SSO changes." : "No unsaved SSO changes."}</span>
          <Button variant="ghost" onClick={draft.reset} disabled={!draft.isDirty || settings.isSaving}>Discard changes</Button>
          <Button variant="secondary" onClick={() => void settings.testSsoSettings().catch(() => undefined)} disabled={settings.isTesting || settings.isSaving || draft.isDirty} title={draft.isDirty ? "Save changes before testing" : undefined}>{settings.isTesting ? "Testing…" : "Test connection"}</Button>
          <Button onClick={() => void save()} disabled={!draft.isDirty || settings.isSaving || settings.isTesting}>{settings.isSaving ? "Saving…" : "Save SSO settings"}</Button>
        </CardFooter>
      </Card>
    </PageShell>
  );
}

function Status({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs font-medium text-copy-label">{label}</div><div className="mt-1 text-copy-secondary">{value}</div></div>;
}
