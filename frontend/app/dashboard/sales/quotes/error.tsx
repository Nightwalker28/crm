"use client";
import { RouteErrorState } from "@/components/ui/RouteStates";

export default function QuotesError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteErrorState
      title="Unable to load quotes"
      reset={reset}
      backHref="/dashboard"
      backLabel="Return to dashboard"
    />
  );
}
