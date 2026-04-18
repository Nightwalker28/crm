"use client";

import { X } from "lucide-react";

import { DialogClose } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function DialogIconClose({ className }: { className?: string }) {
  return (
    <DialogClose
      aria-label="Close dialog"
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-100",
        className,
      )}
    >
      <X className="h-4 w-4" />
    </DialogClose>
  );
}
