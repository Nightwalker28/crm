"use client";

import Image from "next/image";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogPanel,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogBackdrop,
} from "@/components/ui/dialog";

type User = {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  photo_url?: string;
};

type Props = {
  open: boolean;
  user: User;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

export default function RejectUserDialog({ open, user, onCancel, onConfirm }: Props) {
  return (
    <Dialog open={open} onClose={onCancel}>
      <DialogBackdrop />

      <div className="fixed inset-0 z-[30] flex items-center justify-center p-4">
        <DialogPanel className="w-88 sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>Reject pending user</DialogTitle>
            <DialogClose className="text-neutral-900 hover:bg-red-400/90 cursor-pointer p-0.5 bg-neutral-400/50 rounded-full">
              <X size={12} />
            </DialogClose>
          </DialogHeader>

          <DialogDescription>
            Are you sure you want to reject this user request, this action is irreversible.
          </DialogDescription>

          <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-neutral-950 border border-neutral-800 my-4">
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

            <div className="flex flex-col">
              <span className="text-xs font-medium">
                {user.first_name} {user.last_name}
              </span>
              <span className="text-[11px] text-neutral-400">{user.email}</span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => onConfirm()}>
              Reject
            </Button>
          </DialogFooter>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
