"use client";

import { useParams } from "next/navigation";

import { DocumentPreviewPage } from "@/components/transactions/DocumentPreviewPage";
import { DASHBOARD_ROUTES } from "@/lib/routes";

/** Invoice preview (13d §3.3): the shared preview and PDF. */
export default function InvoicePreviewPage() {
  const params = useParams<{ invoiceId: string }>();
  const recordId = Number(params.invoiceId);
  return (
    <DocumentPreviewPage
      moduleKey="finance_pos"
      recordId={recordId}
      title="Invoice preview"
      backHref={`${DASHBOARD_ROUTES.invoices}/${recordId}`}
      backLabel="Back to invoice"
    />
  );
}
