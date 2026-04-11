"use client";

import { useEffect, useState } from "react";
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";

type User = {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  team_id: number;
  role_id: number;
  photo_url?: string;
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
  onSave: (id: number, form: { role_id: number; team_id: number }) => void;
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

  useEffect(() => {
    setRole(user.role_id);
    setTeam(user.team_id);
  }, [user]);

  const isSelf = currentUserId != null && user.id === currentUserId;

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogBackdrop />

      <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
        <DialogPanel className="w-88 sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>Editing User</DialogTitle>
            <DialogClose className="text-neutral-400/70 hover:text-red-400/90 cursor-pointer">
              <X size={16} />
            </DialogClose>
          </DialogHeader>

          <div className="flex flex-col gap-4 mt-2">
            <div className="relative rounded-md">
              <div
                className="absolute inset-0 pointer-events-none mix-blend-multiply bg-repeat
                bg-size-[150px_150px] bg-[url('https://grainy-gradients.vercel.app/noise.svg')]
                opacity-25 rounded-md"
              />

              <div
                className="relative z-10 flex items-center gap-2 px-3 py-2 rounded-md
                border border-white/10 bg-white/6 backdrop-blur-md
                text-neutral-100 transition-colors duration-150"
              >
                {user.photo_url ? (
                  <Image
                    src={user.photo_url}
                    alt=""
                    width={34}
                    height={34}
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
            </FieldGroup>
          </div>

          <DialogFooter className="mt-4">
            <Button size="sm" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => onSave(user.id, { role_id: role, team_id: team })}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
