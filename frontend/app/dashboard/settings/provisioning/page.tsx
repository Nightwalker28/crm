"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useProvisioningSettings } from "@/hooks/admin/useIdentitySettings";
import { useSsoDraft } from "@/hooks/admin/useSsoDraft";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";

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
    <div className="flex flex-col gap-5 pb-20 text-copy-primary">
      {!settings.isLoading && !settings.ssoSettings?.enabled ? <div role="status" className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted p-3 text-sm text-copy-secondary">SSO is disabled. You can prepare provisioning defaults now, but automatic provisioning starts only after SSO is enabled.</div> : null}
      <Card className="px-4 py-4">
        <div className="flex flex-col gap-4">
          <div><h2 className="text-sm font-semibold">User provisioning</h2><p className="text-xs text-copy-muted">Choose how verified identities map to users, roles, and teams.</p></div>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={draft.draft.auto_provision_users} disabled={settings.isLoading || settings.isSaving} onCheckedChange={(checked) => draft.update("auto_provision_users", checked === true)} />Auto-provision users</label>
          <div className="grid gap-4 md:grid-cols-2">
            <Field><FieldLabel>Default role</FieldLabel><Select value={draft.draft.default_role_id || "__none__"} onValueChange={(value) => draft.update("default_role_id", value === "__none__" ? "" : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">None</SelectItem>{settings.roles.map((role) => <SelectItem key={role.id} value={String(role.id)}>{role.name}</SelectItem>)}</SelectContent></Select><FieldDescription>Applied only to newly provisioned users.</FieldDescription></Field>
            <Field><FieldLabel>Default team</FieldLabel><Select value={draft.draft.default_team_id || "__none__"} onValueChange={(value) => draft.update("default_team_id", value === "__none__" ? "" : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">None</SelectItem>{settings.teams.map((team) => <SelectItem key={team.id} value={String(team.id)}>{team.name}</SelectItem>)}</SelectContent></Select></Field>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Field><FieldLabel>Email claim</FieldLabel><Input value={draft.draft.email_claim} onChange={(event) => draft.update("email_claim", event.target.value)} /></Field>
            <Field><FieldLabel>First name claim</FieldLabel><Input value={draft.draft.first_name_claim} onChange={(event) => draft.update("first_name_claim", event.target.value)} /></Field>
            <Field><FieldLabel>Last name claim</FieldLabel><Input value={draft.draft.last_name_claim} onChange={(event) => draft.update("last_name_claim", event.target.value)} /></Field>
          </div>
        </div>
      </Card>
      <div className="sticky bottom-0 z-10 flex flex-col gap-2 border-t border-line-default bg-surface/95 px-4 py-3 backdrop-blur sm:flex-row sm:justify-end"><Button variant="ghost" onClick={draft.reset} disabled={!draft.isDirty || settings.isSaving}>Discard changes</Button><Button onClick={() => void save()} disabled={!draft.isDirty || settings.isSaving}>{settings.isSaving ? "Saving…" : "Save provisioning"}</Button></div>
    </div>
  );
}
