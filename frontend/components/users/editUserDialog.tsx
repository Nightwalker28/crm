"use client";

import type { StatusDescriptor } from "@/lib/statusStyles";
import { useEffect, useState } from "react";
import Image from "next/image";
import { StatusValue } from "@/components/ui/StatusValue";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogPanel,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogBackdrop,
} from "@/components/ui/dialog";
import { DialogIconClose } from "@/components/ui/DialogIconClose";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { resolveMediaUrl } from "@/lib/media";
import { useConfirm } from "@/hooks/useConfirm";

type User = {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  team_id: number;
  role_id: number;
  photo_url?: string;
  auth_mode?: "manual_only" | "manual_or_google";
  mfa_enabled?: boolean;
  mfa_required?: boolean;
  is_active: "active" | "inactive";
};

type RoleOption = { id: number; name: string };
type TeamOption = { id: number; name: string };

type Props = {
  open: boolean;
  user: User;
  roles: RoleOption[];
  teams: TeamOption[];
  currentUserId: number | null;

  onClose: () => void;
  onSave: (id: number, form: { role_id: number; team_id: number; auth_mode: "manual_only" | "manual_or_google"; is_active: "active" | "inactive" }) => Promise<void>;
  onResetMfa?: (id: number) => Promise<void>;
  isResettingMfa?: boolean;
};

export default function EditUserDialog({
  open,
  user,
  roles,
  teams,
  currentUserId,
  onClose,
  onSave,
  onResetMfa,
  isResettingMfa = false,
}: Props) {
  const { confirm } = useConfirm();
  const [role, setRole] = useState<number>(user.role_id);
  const [team, setTeam] = useState<number>(user.team_id);
  const [authMode, setAuthMode] = useState<"manual_only" | "manual_or_google">(user.auth_mode ?? "manual_or_google");
  const [status, setStatus] = useState<"active" | "inactive">(user.is_active);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    setRole(user.role_id);
    setTeam(user.team_id);
    setAuthMode(user.auth_mode ?? "manual_or_google");
    setStatus(user.is_active);
    setIsSaving(false);
    setSaveError(false);
  }, [user]);

  const isSelf = currentUserId != null && user.id === currentUserId;
  const isDirty =
    role !== user.role_id ||
    team !== user.team_id ||
    authMode !== (user.auth_mode ?? "manual_or_google") ||
    status !== user.is_active;
  const mfaStyle: StatusDescriptor = user.mfa_enabled
    ? { tone: "success", label: "Enabled" }
    : user.mfa_required
      ? { tone: "attention", label: "Required" }
      : { tone: "neutral", label: "Off" };

  async function handleClose() {
    if (isSaving || isResettingMfa) return;
    if (isDirty) {
      const confirmed = await confirm({
        title: "Discard user changes?",
        description: "The role, team, sign-in, or status changes in this dialog will be lost.",
        confirmLabel: "Discard changes",
        variant: "destructive",
      });
      if (!confirmed) return;
    }
    onClose();
  }

  async function handleSave() {
    if (!isDirty || isSaving) return;
    try {
      setIsSaving(true);
      setSaveError(false);
      await onSave(user.id, { role_id: role, team_id: team, auth_mode: authMode, is_active: status });
    } catch {
      setSaveError(true);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={() => void handleClose()}>
      <DialogBackdrop />

      <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
        <DialogPanel size="md">
          <DialogHeader>
            <div>
              <DialogTitle>Edit user</DialogTitle>
              <DialogDescription className="mt-1 text-copy-muted">
                Manage this user&apos;s tenant role, team, sign-in mode, and account access.
              </DialogDescription>
            </div>
            <DialogIconClose />
          </DialogHeader>

          <div className="mt-4 flex flex-col gap-4">
            <div className="flex items-center gap-3 rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-3 py-3">
              {user.photo_url ? (
                <Image
                  src={resolveMediaUrl(user.photo_url)}
                  alt=""
                  width={36}
                  height={36}
                  unoptimized
                  className="h-9 w-9 rounded-[var(--radius-control-sm)] object-cover"
                />
              ) : (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control-sm)] border border-line-default bg-surface-raised text-xs font-semibold text-copy-secondary">
                  {(user.first_name[0] || user.email[0] || "?").toUpperCase()}
                </div>
              )}
              <div className="min-w-0 text-sm">
                <div className="truncate font-medium text-copy-primary">
                  {[user.first_name, user.last_name].filter(Boolean).join(" ") || "Unnamed user"}
                </div>
                <div className="truncate text-xs text-copy-muted">{user.email}</div>
              </div>
            </div>

            {saveError ? (
              <div role="alert" className="rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
                The user could not be updated. Review the selections and try again.
              </div>
            ) : null}

            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="edit-user-team">Team</FieldLabel>

                <Select
                  value={String(team)}
                  onValueChange={(v) => setTeam(Number(v))}
                >
                  <SelectTrigger id="edit-user-team" aria-label="Team">
                    <SelectValue placeholder="Select team" />
                  </SelectTrigger>

                  <SelectContent>
                    {teams.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <FieldDescription>
                  Choose which team this user belongs to.
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="edit-user-role">Role</FieldLabel>

                <Select
                  value={String(role)}
                  onValueChange={(v) => setRole(Number(v))}
                  disabled={isSelf}
                >
                  <SelectTrigger id="edit-user-role" aria-label="Role">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>

                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r.id} value={String(r.id)}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <FieldDescription>Select what this user can do.</FieldDescription>

                {isSelf && (
                  <FieldError>
                    You cannot change your own role from this page.
                  </FieldError>
                )}
              </Field>

              <Field>
                <FieldLabel htmlFor="edit-user-auth-mode">Sign-in mode</FieldLabel>
                <Select
                  value={authMode}
                  onValueChange={(value: "manual_only" | "manual_or_google") => setAuthMode(value)}
                >
                  <SelectTrigger id="edit-user-auth-mode" aria-label="Sign-in mode">
                    <SelectValue placeholder="Select sign-in mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual_only">Manual only</SelectItem>
                    <SelectItem value="manual_or_google">Manual + SSO</SelectItem>
                  </SelectContent>
                </Select>

                <FieldDescription>
                  Controls whether the user can sign in manually only or with Google as well.
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="edit-user-status">Status</FieldLabel>
                <Select
                  value={status}
                  onValueChange={(value: "active" | "inactive") => setStatus(value)}
                  disabled={isSelf}
                >
                  <SelectTrigger id="edit-user-status" aria-label="Status">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>

                <FieldDescription>
                  {isSelf
                    ? "You cannot deactivate your own account."
                    : "Inactive users cannot sign in until they are reactivated."}
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel>MFA</FieldLabel>
                <div className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-3 py-3">
                  <div className="min-w-0 text-sm">
                    <StatusValue status={mfaStyle} />
                    <div className="mt-2 text-xs text-copy-muted">
                      {user.mfa_enabled ? "Reset removes the user MFA secret and recovery codes." : "No local MFA secret is active for this user."}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!user.mfa_enabled || isResettingMfa || isSaving}
                    onClick={async () => {
                      if (!onResetMfa) return;
                      const confirmed = await confirm({
                        title: "Reset MFA?",
                        description: `Reset MFA for ${user.email}? The user must enroll again before satisfying MFA policy.`,
                        confirmLabel: "Reset MFA",
                        variant: "destructive",
                      });
                      if (!confirmed) return;
                      try {
                        await onResetMfa(user.id);
                      } catch {
                        // The mutation owns fixed user-facing failure guidance.
                      }
                    }}
                  >
                    Reset
                  </Button>
                </div>
              </Field>
            </FieldGroup>
          </div>

          <DialogFooter className="mt-4">
            <Button size="sm" variant="outline" onClick={() => void handleClose()} disabled={isSaving || isResettingMfa}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!isDirty || isSaving || isResettingMfa}
              onClick={() => void handleSave()}
            >
              {isSaving ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
