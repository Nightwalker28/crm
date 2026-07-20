"use client";
import { RouteErrorState } from "@/components/ui/RouteStates";

export default function OrdersError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteErrorState
      title="Unable to load orders"
      reset={reset}
      backHref="/dashboard"
      backLabel="Return to dashboard"
    />
  );
}
