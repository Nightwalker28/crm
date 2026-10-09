import { ApiError, apiFetch } from "@/lib/api";

/**
 * Document PDFs and previews (13d §3.3). One server-side renderer: the preview is the HTML the
 * PDF is made from, so what the operator reviews is what the customer receives.
 */

/** The modules whose records print as a document. */
export type PrintableModuleKey =
  | "sales_quotes"
  | "sales_orders"
  | "finance_pos"
  | "finance_credit_notes"
  | "purchase_orders"
  | "purchase_bills"
  | "purchase_vendor_credits"
  | "inventory_deliveries"
  | "purchase_receipts";

async function failure(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => null)) as { detail?: unknown } | null;
  throw new ApiError(res.status, res.status < 500 && typeof body?.detail === "string" ? body.detail : fallback);
}

export async function fetchDocumentPreview(moduleKey: PrintableModuleKey, recordId: number | string): Promise<string> {
  const res = await apiFetch(`/records/${moduleKey}/${recordId}/preview`);
  if (!res.ok) await failure(res, "The document preview could not be loaded.");
  return res.text();
}

/** Downloads the document's PDF: its snapshot once issued, a live draft before that. */
export async function downloadDocumentPdf(moduleKey: PrintableModuleKey, recordId: number | string): Promise<void> {
  const res = await apiFetch(`/records/${moduleKey}/${recordId}/pdf?download=true`);
  if (!res.ok) await failure(res, "The PDF could not be made. Try again in a moment.");
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "document.pdf";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
