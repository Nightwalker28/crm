"use client";

import { useParams } from "next/navigation";

import { CreditNoteDocumentPage } from "@/components/finance/CreditNoteDocumentPage";

export default function CreditNotePage() {
  const params = useParams<{ creditNoteId: string }>();
  return <CreditNoteDocumentPage creditNoteId={/^\d+$/.test(params.creditNoteId) ? Number(params.creditNoteId) : null} />;
}
