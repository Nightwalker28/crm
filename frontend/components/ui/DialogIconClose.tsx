"use client";

import { X } from "lucide-react";

import { DialogClose } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function DialogIconClose({ className }: { className?: string }) {
  return (
    <DialogClose
      aria-label="Close dialog"
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] text-copy-muted transition-colors hover:bg-surface-muted hover:text-copy-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        className,
      )}
    >
      <X className="h-4 w-4" />
    </DialogClose>
  );
}
