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
  size = "default",
}: {
  document: DocumentReference;
  showCopy?: boolean;
  resolveView?: () => Promise<{ url: string }>;
  /** `sm` inside a table row (design.md 4.2), so the cluster matches its siblings (R4). */
  size?: "default" | "sm";
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

  // These two live in a table row, so there is no space for the reason beside them and
  // 4.7's "render it only when it works" does not apply either: a broken provider link is
  // a state the operator has to be able to see and fix, not an action that does not exist
  // yet. So the control stays disabled and the reason becomes readable — `title` alone is a
  // pointer-only affordance, invisible to the keyboard and to a screen reader (8).
  const reasonId = disabledReason ? `document-${document.id}-unavailable` : undefined;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {disabledReason ? <span id={reasonId} className="sr-only">{disabledReason}</span> : null}
      <Button type="button" variant="outline" size={size} onClick={() => void openDocument()} disabled={Boolean(disabledReason)} title={disabledReason ?? undefined} aria-describedby={reasonId}>
        <ExternalLink />
        View
      </Button>
      {showCopy ? (
        <Button type="button" variant="outline" size={size} onClick={() => void copyLink()} disabled={Boolean(disabledReason)} title={disabledReason ?? undefined} aria-describedby={reasonId}>
          <Copy />
          Copy link
        </Button>
      ) : null}
    </div>
  );
}
