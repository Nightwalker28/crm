"use client";

import { RouteErrorState, type RouteErrorBoundaryProps } from "@/components/ui/RouteStates";

export default function QuotesError({ reset }: RouteErrorBoundaryProps) {
  return <RouteErrorState title="Quotes could not be loaded" reset={reset} />;
}
