"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useConfirm } from "@/hooks/useConfirm";
import { apiFetch } from "@/lib/api";

type Props = {
  endpoint: string;
  label: string;
  recordName: string;
  redirectHref: string;
  queryKeys?: string[];
  /**
   * `menuItem` for the record header's overflow menu (§4.7). §2.2 allows one filled button
   * per view, and a record page's primary workflow action — Convert, Send, Issue — has a
   * better claim on it than Delete does. The confirm, the request and the redirect stay
   * here either way; only the trigger changes.
   */
  as?: "button" | "menuItem";
};

export default function RecordDeleteButton({ endpoint, label, recordName, redirectHref, queryKeys = [], as = "button" }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    const confirmed = await confirm({
      title: `Delete ${label.toLowerCase()}?`,
      description: `Move "${recordName}" to the recycle bin? It can be restored from Settings.`,
      confirmLabel: `Delete ${label}`,
      variant: "destructive",
    });
    if (!confirmed) return;

    try {
      setIsDeleting(true);
      const res = await apiFetch(endpoint, { method: "DELETE" });
      if (!res.ok) throw new Error("Record deletion failed.");
      await Promise.all(queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey: [queryKey] })));
      toast.success(`${label} moved to recycle bin.`);
      router.push(redirectHref);
    } catch {
      toast.error(`Failed to delete ${label.toLowerCase()}. Please try again.`);
    } finally {
      setIsDeleting(false);
    }
  }

  if (as === "menuItem") {
    return (
      <DropdownMenuItem
        // Radix closes the menu on select and would steal focus from the confirmation the
        // handler is about to open, so the close is prevented and the dialog owns focus.
        onSelect={(event) => {
          event.preventDefault();
          void handleDelete();
        }}
        disabled={isDeleting}
        className="text-state-danger focus:bg-state-danger-muted focus:text-state-danger"
      >
        <Trash2 />
        {isDeleting ? "Deleting…" : `Delete ${label.toLowerCase()}`}
      </DropdownMenuItem>
    );
  }

  return (
    <Button type="button" variant="destructive" onClick={() => void handleDelete()} disabled={isDeleting}>
      <Trash2 className="h-4 w-4" />
      {isDeleting ? "Deleting..." : "Delete"}
    </Button>
  );
}
