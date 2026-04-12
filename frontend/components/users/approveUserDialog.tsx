"use client";

import { useState } from "react";
import Image from "next/image";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogPanel,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogBackdrop,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";

type User = {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  photo_url?: string;
};

type RoleOption = { id: number; name: string };
type TeamOption = { id: number; name: string };

type Props = {
  open: boolean;
  user: User;
  roles: RoleOption[];
  teams: TeamOption[];
  onClose: () => void;
  onApprove: (id: number, roleId: number, teamId: number) => void | Promise<void>;
};

export default function ApproveUserDialog({
  open,
  user,
  roles,
  teams,
  onClose,
  onApprove,
}: Props) {
  const [role, setRole] = useState<number | "">("");
  const [team, setTeam] = useState<number | "">("");

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogBackdrop />

      <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
        <DialogPanel className="w-88 sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>Approve user</DialogTitle>
            <DialogClose className="text-neutral-400/70 hover:text-red-400/90 cursor-pointer">
              <X size={16} />
            </DialogClose>
          </DialogHeader>

          <div className="flex flex-col gap-4 mt-2">
            <div className="flex items-center gap-3 px-3 py-2 rounded-md bg-neutral-950 border border-neutral-800">
              {user.photo_url ? (
                <Image
                  src={user.photo_url}
                  alt=""
                  width={32}
                  height={32}
                  className="h-8 w-8 rounded-lg object-cover"
                />
              ) : (
                <div className="h-8 w-8 rounded-lg bg-neutral-700 flex items-center justify-center text-xs">
                  {user.first_name[0]}
                </div>
              )}

              <div className="flex flex-col text-sm">
                <span className="font-medium">
                  {user.first_name} {user.last_name}
                </span>
                <span className="text-xs text-neutral-400">{user.email}</span>
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

                <FieldDescription>
                  Select what this user can do inside Lynk.
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
              disabled={role === "" || team === ""}
              onClick={() => onApprove(user.id, role as number, team as number)}
            >
              Approve user
            </Button>
          </DialogFooter>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
