"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/hooks/useConfirm";
import { apiFetch } from "@/lib/api";

type Props = {
  endpoint: string;
  label: string;
  recordName: string;
  redirectHref: string;
  queryKeys?: string[];
};

export default function RecordDeleteButton({ endpoint, label, recordName, redirectHref, queryKeys = [] }: Props) {
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
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      await Promise.all(queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey: [queryKey] })));
      toast.success(`${label} moved to recycle bin.`);
      router.push(redirectHref);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Failed to delete ${label.toLowerCase()}.`);
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Button type="button" variant="destructive" onClick={() => void handleDelete()} disabled={isDeleting}>
      <Trash2 className="h-4 w-4" />
      {isDeleting ? "Deleting..." : "Delete"}
    </Button>
  );
}
