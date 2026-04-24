"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogPanel,
  DialogHeader,
  DialogTitle,
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

type User = {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  team_id: number;
  role_id: number;
  photo_url?: string;
  auth_mode?: "manual_only" | "manual_or_google";
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
};

export default function EditUserDialog({
  open,
  user,
  roles,
  teams,
  currentUserId,
  onClose,
  onSave,
}: Props) {
  const [role, setRole] = useState<number>(user.role_id);
  const [team, setTeam] = useState<number>(user.team_id);
  const [authMode, setAuthMode] = useState<"manual_only" | "manual_or_google">(user.auth_mode ?? "manual_or_google");
  const [status, setStatus] = useState<"active" | "inactive">(user.is_active);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRole(user.role_id);
    setTeam(user.team_id);
    setAuthMode(user.auth_mode ?? "manual_or_google");
    setStatus(user.is_active);
  }, [user]);

  const isSelf = currentUserId != null && user.id === currentUserId;

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogBackdrop />

      <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
        <DialogPanel size="md">
          <DialogHeader>
            <DialogTitle>Editing User</DialogTitle>
            <DialogIconClose />
          </DialogHeader>

          <div className="flex flex-col gap-4 mt-2">
            <div className="relative rounded-md">
              <div
                className="noise-overlay absolute inset-0 pointer-events-none rounded-md opacity-25"
              />

              <div
                className="relative z-10 flex items-center gap-2 px-3 py-2 rounded-md
                border border-white/10 bg-white/6 backdrop-blur-md
                text-neutral-100 transition-colors duration-150"
              >
                {user.photo_url ? (
                  <Image
                    src={resolveMediaUrl(user.photo_url)}
                    alt=""
                    width={34}
                    height={34}
                    unoptimized
                    className="h-8.5 w-8.5 rounded-md object-cover shadow-sm"
                  />
                ) : (
                  <div className="h-8 w-8 rounded-md bg-neutral-100 text-black flex items-center justify-center text-xs font-bold shadow-sm">
                    {user.first_name[0]}
                  </div>
                )}

                <div className="flex flex-col text-[13px]">
                  <span className="font-semibold text-neutral-100 whitespace-nowrap overflow-hidden">
                    {user.first_name} {user.last_name}
                  </span>

                  <span className="text-neutral-300 whitespace-nowrap overflow-hidden">
                    {user.email}
                  </span>
                </div>
              </div>
            </div>

            <FieldGroup>
              <Field>
                <FieldLabel>Team</FieldLabel>

                <Select
                  value={String(team)}
                  onValueChange={(v) => setTeam(Number(v))}
                >
                  <SelectTrigger>
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
                <FieldLabel>Role</FieldLabel>

                <Select
                  value={String(role)}
                  onValueChange={(v) => setRole(Number(v))}
                  disabled={isSelf}
                >
                  <SelectTrigger>
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
                <FieldLabel>Sign-In Mode</FieldLabel>
                <Select
                  value={authMode}
                  onValueChange={(value: "manual_only" | "manual_or_google") => setAuthMode(value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select sign-in mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual_only">Manual only</SelectItem>
                    <SelectItem value="manual_or_google">Manual + Google</SelectItem>
                  </SelectContent>
                </Select>

                <FieldDescription>
                  Controls whether the user can sign in manually only or with Google as well.
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel>Status</FieldLabel>
                <Select
                  value={status}
                  onValueChange={(value: "active" | "inactive") => setStatus(value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>

                <FieldDescription>
                  Inactive users cannot sign in until they are reactivated.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </div>

          <DialogFooter className="mt-4">
            <Button size="sm" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={async () => {
                await onSave(user.id, { role_id: role, team_id: team, auth_mode: authMode, is_active: status });
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
