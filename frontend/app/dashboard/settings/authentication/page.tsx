"use client";

import { useCallback } from "react";
import { Check } from "lucide-react";

import { FormSection } from "@/components/forms/RecordFormLayout";
import { ActionBar, FormFooter } from "@/components/ui/ActionBar";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/ui/PageShell";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SegmentedBoolean } from "@/components/ui/SegmentedControl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { useAuthenticationSettings } from "@/hooks/admin/useIdentitySettings";
import { useSsoDraft } from "@/hooks/admin/useSsoDraft";
import type { MfaPolicy } from "@/hooks/admin/useUserManagement";
import { useAutosave } from "@/hooks/useAutosave";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { formatDateTime } from "@/lib/datetime";

/**
 * The page archetype 4's commit rule was written against.
 *
 * It autosaved the MFA select and demanded an explicit Save/Discard footer forty lines
 * below, with nothing on screen separating the two — so an operator who changed the policy
 * had no way to know whether the Save button below applied to it. Both halves were right
 * about their own control and neither said so.
 *
 * Now each control states its own model. The MFA policy is one independent reversible
 * field, so it autosaves and its `SettingsRow` carries the `SaveStateIndicator`. SSO is a
 * **configuration record** — credentials validated together, with a connection test hanging
 * off them — so it keeps a manual save, and autosaving it would fire `testSsoSettings`
 * against a half-typed issuer URL. The footer is no longer sticky (R3): it is an ordinary
 * flex sibling at the end of the section.
 */
export default function AuthenticationSettingsPage() {
  const settings = useAuthenticationSettings();
  const draft = useSsoDraft(settings.ssoSettings);
  useUnsavedChangesGuard(draft.isDirty, settings.isSaving);

  const commitMfaPolicy = useCallback(
    (policy: MfaPolicy) => settings.updateMfaPolicy(policy),
    [settings],
  );
  const mfa = useAutosave(commitMfaPolicy);

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
      <FormSection title="Multi-factor" description="Applies to manual CRM sign-in.">
        <SettingsRow
          label="MFA policy"
          description="Who has to present a second factor when signing in with a password."
          saveState={mfa.state}
          onRetry={mfa.retry}
        >
          <Select
            value={settings.mfaPolicy}
            disabled={settings.isLoading || mfa.isSaving}
            onValueChange={(value) => void mfa.save(value as MfaPolicy)}
          >
            <SelectTrigger className="w-full sm:w-60" aria-label="MFA policy"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="off">Do not require MFA</SelectItem>
              <SelectItem value="admins_only">Require for admins</SelectItem>
              <SelectItem value="all_users">Require for all users</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
      </FormSection>

      <FormSection title="Password policy" description="Platform-enforced password requirements.">
        {settings.isPasswordPolicyLoading ? (
          <p className="text-sm text-copy-muted" aria-live="polite">Loading password requirements…</p>
        ) : settings.passwordPolicy ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {settings.passwordPolicy.requirements.map((requirement) => (
              <div key={requirement} className="flex gap-2 rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-3 py-2 text-sm text-copy-secondary">
                <Check className="mt-0.5 size-4 shrink-0 text-state-success" />
                <span>{requirement}</span>
              </div>
            ))}
          </div>
        ) : (
          <p role="alert" className="text-sm text-state-danger">Password requirements could not be loaded.</p>
        )}
      </FormSection>

      <FormSection title="OIDC SSO" description="Tenant sign-in through an external identity provider. These fields are validated together, so they save as a set.">
        <div className="flex flex-col gap-5">
          <SettingsRow label="Single sign-on" description="Offer the provider as a sign-in method for this workspace.">
            <SegmentedBoolean
              aria-label="Single sign-on"
              value={draft.draft.enabled}
              onValueChange={(checked) => draft.update("enabled", checked)}
              trueLabel="On"
              falseLabel="Off"
              disabled={settings.isLoading || settings.isSaving}
            />
          </SettingsRow>
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
          <div className="grid gap-3 border-t border-line-subtle pt-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
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
              <ActionBar size="sm">
                <Button variant="outline" onClick={() => void settings.testSsoSettings().catch(() => undefined)} disabled={settings.isTesting || draft.isDirty}>{settings.isTesting ? "Testing…" : "Retry"}</Button>
              </ActionBar>
            </div>
          ) : null}
          {/* R3: this was `sticky bottom-0 ... backdrop-blur`. Nothing about a save bar
              needed to float over the fields it commits. */}
          <FormFooter status={draft.isDirty ? "You have unsaved SSO changes." : "No unsaved SSO changes."}>
            <Button variant="ghost" onClick={draft.reset} disabled={!draft.isDirty || settings.isSaving}>Discard changes</Button>
            <Button variant="outline" onClick={() => void settings.testSsoSettings().catch(() => undefined)} disabled={settings.isTesting || settings.isSaving || draft.isDirty} title={draft.isDirty ? "Save changes before testing" : undefined}>{settings.isTesting ? "Testing…" : "Test connection"}</Button>
            <Button onClick={() => void save()} disabled={!draft.isDirty || settings.isSaving || settings.isTesting}>{settings.isSaving ? "Saving…" : "Save SSO settings"}</Button>
          </FormFooter>
        </div>
      </FormSection>
    </PageShell>
  );
}

function Status({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs font-medium text-copy-label">{label}</div><div className="mt-1 text-copy-secondary">{value}</div></div>;
}
