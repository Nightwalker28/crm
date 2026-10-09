"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";

import RecurringInvoiceFormPage from "@/components/finance/recurring/RecurringInvoiceFormPage";
import { RouteLoadingState } from "@/components/ui/RouteStates";

export default function RecurringInvoiceRecordPage() {
  const params = useParams<{ recurringId: string }>();
  return (
    <Suspense fallback={<RouteLoadingState label="recurring invoice" />}>
      <RecurringInvoiceFormPage profileId={Number(params.recurringId)} />
    </Suspense>
  );
}
