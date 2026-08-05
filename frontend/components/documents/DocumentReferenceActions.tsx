"use client";

import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { type DocumentItem, resolveDocumentView } from "@/hooks/useDocuments";

type DocumentReference = Pick<DocumentItem, "id" | "storage_provider" | "provider_status">;

function unavailableReason(document: DocumentReference) {
  if (document.provider_status === "permission_lost") return "Reconnect the provider account to restore access.";
  if (document.provider_status === "missing") return "The file is no longer available at the provider.";
  if (document.provider_status === "deleted") return "The provider file has been deleted.";
  return null;
}

export function DocumentReferenceActions({
  document,
  showCopy = false,
  resolveView: resolveViewOverride,
}: {
  document: DocumentReference;
  showCopy?: boolean;
  resolveView?: () => Promise<{ url: string }>;
}) {
  const disabledReason = document.storage_provider === "local" ? null : unavailableReason(document);

  async function resolveView() {
    if (disabledReason) throw new Error(disabledReason);
    return resolveViewOverride ? resolveViewOverride() : resolveDocumentView(document.id);
  }

  async function openDocument() {
    const popup = window.open("", "_blank");
    if (popup) popup.opener = null;
    try {
      const view = await resolveView();
      if (popup) popup.location.href = view.url;
      else window.open(view.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      popup?.close();
      toast.error(error instanceof Error ? error.message : "This document cannot be opened.");
    }
  }

  async function copyLink() {
    try {
      const view = await resolveView();
      await navigator.clipboard.writeText(view.url);
      toast.success("Document link copied.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The document link could not be copied.");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" onClick={() => void openDocument()} disabled={Boolean(disabledReason)} title={disabledReason ?? undefined}>
        <ExternalLink className="h-4 w-4" />
        View
      </Button>
      {showCopy ? (
        <Button type="button" variant="outline" onClick={() => void copyLink()} disabled={Boolean(disabledReason)} title={disabledReason ?? undefined}>
          <Copy className="h-4 w-4" />
          Copy link
        </Button>
      ) : null}
    </div>
  );
}
