"use client";

import { useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { downloadClientPdf } from "@/hooks/useClientPortal";

/** *Download PDF* for a quote, order or invoice in the portal (13d §3.7): the document as the team sends it. */
export function ClientPdfButton({
  kind,
  id,
  name,
  variant = "outline",
  size,
}: {
  kind: "quotes" | "orders" | "invoices";
  id: number;
  name: string;
  variant?: "outline" | "ghost" | "default";
  size?: "sm";
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={busy}
      aria-label={`Download ${name} as PDF`}
      onClick={async () => {
        setBusy(true);
        try {
          await downloadClientPdf(kind, id, name);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "The PDF could not be downloaded.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <RefreshCw className="animate-spin" /> : <Download />}
      {busy ? "Preparing…" : "PDF"}
    </Button>
  );
}
