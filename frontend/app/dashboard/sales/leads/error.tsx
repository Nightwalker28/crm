"use client";

import { RouteErrorState, type RouteErrorBoundaryProps } from "@/components/ui/RouteStates";

export default function LeadsError({ reset }: RouteErrorBoundaryProps) {
  return <RouteErrorState title="Unable to load leads" reset={reset} />;
}
