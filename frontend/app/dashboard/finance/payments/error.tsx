"use client";

import { RouteErrorState, type RouteErrorBoundaryProps } from "@/components/ui/RouteStates";

export default function PaymentsError({ reset }: RouteErrorBoundaryProps) {
  return (
    <RouteErrorState
      title="Payments could not be loaded"
      reset={reset}
      backHref="/dashboard/finance/pos"
      backLabel="Return to invoices"
    />
  );
}
