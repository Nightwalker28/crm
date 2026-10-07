"use client";

import Link from "next/link";
import { Copy } from "lucide-react";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { cloneHref } from "@/hooks/useCloneDraft";

/**
 * *Clone* in a record header's overflow menu (13b Phase 5, F3.8): the module's create form,
 * filled from this record (`?clone=<id>`). Nothing is saved until the user creates it.
 * Show it only to users who may create in the module; the server checks again.
 */
export function RecordCloneMenuItem({ newHref, recordId }: { newHref: string; recordId: string | number }) {
  return (
    <DropdownMenuItem asChild>
      <Link href={cloneHref(newHref, recordId)}>
        <Copy />
        Clone
      </Link>
    </DropdownMenuItem>
  );
}
