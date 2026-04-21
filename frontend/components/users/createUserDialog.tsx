"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBackdrop,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { DialogIconClose } from "@/components/ui/DialogIconClose";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type RoleOption = { id: number; name: string };
type TeamOption = { id: number; name: string };
type AuthMode = "manual_only" | "manual_or_google";
type UserStatus = "active" | "inactive";

type CreatePayload = {
  first_name: string;
  last_name: string;
  email: string;
  role_id: number;
  team_id: number;
  auth_mode: AuthMode;
  is_active: UserStatus;
};

type Props = {
  open: boolean;
  roles: RoleOption[];
  teams: TeamOption[];
  onClose: () => void;
  onCreate: (payload: CreatePayload) => Promise<{ setup_link?: string | null }>;
};

const emptyForm = {
  first_name: "",
  last_name: "",
  email: "",
  role_id: "",
  team_id: "",
  auth_mode: "manual_only" as AuthMode,
  is_active: "active" as UserStatus,
};

function RequiredMark() {
  return <span className="text-red-400">*</span>;
}

export default function CreateUserDialog({ open, roles, teams, onClose, onCreate }: Props) {
  const [form, setForm] = useState(emptyForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupLink, setSetupLink] = useState<string | null>(null);

  const canSubmit = useMemo(
    () => Boolean(form.email.trim() && form.role_id && form.team_id),
    [form.email, form.role_id, form.team_id],
  );

  function handleClose() {
    setForm(emptyForm);
    setError(null);
    setSetupLink(null);
    setIsSubmitting(false);
    onClose();
  }

  async function handleCreate() {
    try {
      setIsSubmitting(true);
      setError(null);

      const result = await onCreate({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email.trim(),
        role_id: Number(form.role_id),
        team_id: Number(form.team_id),
        auth_mode: form.auth_mode,
        is_active: form.is_active,
      });

      setSetupLink(result.setup_link ?? null);
      if (!result.setup_link) {
        handleClose();
      }
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create user");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function copySetupLink() {
    if (!setupLink) return;
    await navigator.clipboard.writeText(setupLink);
    toast.success("Setup link copied.");
  }

  return (
    <Dialog open={open} onClose={handleClose}>
      <DialogBackdrop />

      <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
        <DialogPanel size="xl">
          <DialogHeader>
            <DialogTitle>{setupLink ? "User Created" : "Add User"}</DialogTitle>
            <DialogIconClose />
          </DialogHeader>

          {setupLink ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-md border border-emerald-800/60 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
                Manual sign-in is enabled for this user. Share the setup link below so they can create their password.
              </div>

              <Field>
                <FieldLabel>Setup Link</FieldLabel>
                <div className="flex gap-2">
                  <Input value={setupLink} readOnly />
                  <Button type="button" variant="outline" onClick={copySetupLink}>
                    <Copy />
                    Copy
                  </Button>
                </div>
              </Field>
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              {error && (
                <div className="rounded-md border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm text-red-200">
                  {error}
                </div>
              )}

              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel>First Name</FieldLabel>
                  <Input
                    value={form.first_name}
                    onChange={(event) => setForm((current) => ({ ...current, first_name: event.target.value }))}
                  />
                </Field>

                <Field>
                  <FieldLabel>Last Name</FieldLabel>
                  <Input
                    value={form.last_name}
                    onChange={(event) => setForm((current) => ({ ...current, last_name: event.target.value }))}
                  />
                </Field>

                <Field className="sm:col-span-2">
                  <FieldLabel>Email <RequiredMark /></FieldLabel>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                  />
                </Field>

                <Field>
                  <FieldLabel>Team <RequiredMark /></FieldLabel>
                  <Select value={form.team_id} onValueChange={(value) => setForm((current) => ({ ...current, team_id: value }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select team" />
                    </SelectTrigger>
                    <SelectContent>
                      {teams.map((team) => (
                        <SelectItem key={team.id} value={String(team.id)}>
                          {team.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel>Role <RequiredMark /></FieldLabel>
                  <Select value={form.role_id} onValueChange={(value) => setForm((current) => ({ ...current, role_id: value }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((role) => (
                        <SelectItem key={role.id} value={String(role.id)}>
                          {role.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel>Sign-In Mode</FieldLabel>
                  <Select
                    value={form.auth_mode}
                    onValueChange={(value: AuthMode) => setForm((current) => ({ ...current, auth_mode: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual_only">Manual only</SelectItem>
                      <SelectItem value="manual_or_google">Manual + Google</SelectItem>
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    Manual-capable users receive a password setup link after creation.
                  </FieldDescription>
                </Field>

                <Field>
                  <FieldLabel>Status</FieldLabel>
                  <Select
                    value={form.is_active}
                    onValueChange={(value: UserStatus) => setForm((current) => ({ ...current, is_active: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </FieldGroup>
            </div>
          )}

          <DialogFooter className="mt-5">
            <Button variant="outline" onClick={handleClose}>
              {setupLink ? "Done" : "Cancel"}
            </Button>
            {!setupLink && (
              <Button onClick={handleCreate} disabled={!canSubmit || isSubmitting}>
                {isSubmitting ? "Creating..." : "Create User"}
              </Button>
            )}
          </DialogFooter>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
