"use client";

import { useState } from "react";
import { FileDown } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { downloadDocumentPdf, type PrintableModuleKey } from "@/lib/documentPdf";

/** *Download PDF* on a document page (13d §3.3). */
export function DocumentPdfButton({
  moduleKey,
  recordId,
  label = "Download PDF",
  variant = "outline",
}: {
  moduleKey: PrintableModuleKey;
  recordId: number;
  label?: string;
  variant?: "outline" | "ghost" | "default";
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant={variant}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await downloadDocumentPdf(moduleKey, recordId);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "The PDF could not be made.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <FileDown />
      {busy ? "Preparing PDF…" : label}
    </Button>
  );
}

/** *Download PDF* in a record's overflow menu (quotes and orders). */
export function DocumentPdfMenuItem({ moduleKey, recordId }: { moduleKey: PrintableModuleKey; recordId: number }) {
  return (
    <DropdownMenuItem
      onSelect={() => {
        void downloadDocumentPdf(moduleKey, recordId).catch((error) => {
          toast.error(error instanceof Error ? error.message : "The PDF could not be made.");
        });
      }}
    >
      <FileDown />
      Download PDF
    </DropdownMenuItem>
  );
}
