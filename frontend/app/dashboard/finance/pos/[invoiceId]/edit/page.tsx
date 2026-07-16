"use client";

import { useParams } from "next/navigation";

import PosInvoiceRecordFormPage from "@/components/finance/pos/PosInvoiceRecordFormPage";

export default function EditInvoicePage() {
  const params = useParams<{ invoiceId: string }>();
  return <PosInvoiceRecordFormPage mode="edit" invoiceId={params.invoiceId} />;
}
