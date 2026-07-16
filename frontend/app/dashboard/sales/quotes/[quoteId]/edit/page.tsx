"use client";

import { useParams } from "next/navigation";

import QuoteRecordFormPage from "@/components/quotes/QuoteRecordFormPage";

export default function EditQuotePage() {
  const params = useParams<{ quoteId: string }>();
  return <QuoteRecordFormPage mode="edit" quoteId={params.quoteId} />;
}
