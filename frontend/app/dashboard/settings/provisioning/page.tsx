"use client";

import { FormSection } from "@/components/forms/RecordFormLayout";
import { FormFooter } from "@/components/ui/ActionBar";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { SegmentedBoolean } from "@/components/ui/SegmentedControl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { useProvisioningSettings } from "@/hooks/admin/useIdentitySettings";
import { useSsoDraft } from "@/hooks/admin/useSsoDraft";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { isForbiddenError } from "@/lib/api";
import { SETTINGS_ROUTES } from "@/lib/routes";

/**
 * A configuration record (archetype 4): the claim names and the provisioning defaults are
 * validated together and applied by the same SSO write, so it keeps a manual save. The
 * footer is no longer sticky (R3), and the auto-provision boolean is a `SegmentedBoolean`
 * rather than a lone `Checkbox` — a checkbox means *many from a set*.
 */
export default function ProvisioningSettingsPage() {
  const settings = useProvisioningSettings();
  const draft = useSsoDraft(settings.ssoSettings);
  useUnsavedChangesGuard(draft.isDirty, settings.isSaving);

  async function save() {
    try {
      await settings.updateSsoSettings({ auto_provision_users: draft.draft.auto_provision_users, default_role_id: draft.draft.default_role_id ? Number(draft.draft.default_role_id) : null, default_team_id: draft.draft.default_team_id ? Number(draft.draft.default_team_id) : null, email_claim: draft.draft.email_claim || "email", first_name_claim: draft.draft.first_name_claim || null, last_name_claim: draft.draft.last_name_claim || null });
      draft.markSaved();
    } catch {
      // The mutation presents a safe error and the draft remains dirty.
    }
  }

  return (
    <PageShell
      variant="settings"
      title="Provisioning"
      description="Choose how verified identities map to users, roles, and teams."
      isPermissionDenied={isForbiddenError(settings.loadError)}
      backHref={SETTINGS_ROUTES.root}
      backLabel="Back to Settings"
    >
      {!settings.isLoading && !settings.ssoSettings?.enabled ? <div role="status" className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted p-3 text-sm text-copy-secondary">SSO is disabled. You can prepare provisioning defaults now, but automatic provisioning starts only after SSO is enabled.</div> : null}
      <FormSection title="User provisioning" description="These apply together on the next verified sign-in, so they save as a set.">
        <div className="flex flex-col gap-5">
          <SettingsRow label="Auto-provision users" description="Create a CRM user the first time a verified identity signs in.">
            <SegmentedBoolean
              aria-label="Auto-provision users"
              value={draft.draft.auto_provision_users}
              onValueChange={(checked) => draft.update("auto_provision_users", checked)}
              trueLabel="On"
              falseLabel="Off"
              disabled={settings.isLoading || settings.isSaving}
            />
          </SettingsRow>
          <div className="grid gap-4 md:grid-cols-2">
            <Field><FieldLabel>Default role</FieldLabel><Select value={draft.draft.default_role_id || "__none__"} onValueChange={(value) => draft.update("default_role_id", value === "__none__" ? "" : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">None</SelectItem>{settings.roles.map((role) => <SelectItem key={role.id} value={String(role.id)}>{role.name}</SelectItem>)}</SelectContent></Select><FieldDescription>Applied only to newly provisioned users.</FieldDescription></Field>
            <Field><FieldLabel>Default team</FieldLabel><Select value={draft.draft.default_team_id || "__none__"} onValueChange={(value) => draft.update("default_team_id", value === "__none__" ? "" : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">None</SelectItem>{settings.teams.map((team) => <SelectItem key={team.id} value={String(team.id)}>{team.name}</SelectItem>)}</SelectContent></Select></Field>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Field><FieldLabel>Email claim</FieldLabel><Input value={draft.draft.email_claim} onChange={(event) => draft.update("email_claim", event.target.value)} /></Field>
            <Field><FieldLabel>First name claim</FieldLabel><Input value={draft.draft.first_name_claim} onChange={(event) => draft.update("first_name_claim", event.target.value)} /></Field>
            <Field><FieldLabel>Last name claim</FieldLabel><Input value={draft.draft.last_name_claim} onChange={(event) => draft.update("last_name_claim", event.target.value)} /></Field>
          </div>
          <FormFooter status={draft.isDirty ? "You have unsaved changes." : "No unsaved changes."}>
            <Button variant="ghost" onClick={draft.reset} disabled={!draft.isDirty || settings.isSaving}>Discard changes</Button>
            <Button onClick={() => void save()} disabled={!draft.isDirty || settings.isSaving}>{settings.isSaving ? "Saving…" : "Save provisioning"}</Button>
          </FormFooter>
        </div>
      </FormSection>
    </PageShell>
  );
}
