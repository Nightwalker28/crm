"use client";
import { RouteErrorState } from "@/components/ui/RouteStates";

export default function PaymentsError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteErrorState
      title="Unable to load payments"
      reset={reset}
      backHref="/dashboard/finance/pos"
      backLabel="Return to invoices"
    />
  );
}
