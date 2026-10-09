"use client";

import { Suspense } from "react";

import RecurringInvoiceFormPage from "@/components/finance/recurring/RecurringInvoiceFormPage";
import { RouteLoadingState } from "@/components/ui/RouteStates";

export default function NewRecurringInvoicePage() {
  return (
    <Suspense fallback={<RouteLoadingState label="recurring invoice" />}>
      <RecurringInvoiceFormPage />
    </Suspense>
  );
}
