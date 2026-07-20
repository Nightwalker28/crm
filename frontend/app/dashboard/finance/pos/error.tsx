"use client";
import { RouteErrorState } from "@/components/ui/RouteStates";

export default function InvoicesError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteErrorState
      title="Unable to load invoices"
      reset={reset}
      backHref="/dashboard"
      backLabel="Return to dashboard"
    />
  );
}
