"use client";

import { RouteErrorState, type RouteErrorBoundaryProps } from "@/components/ui/RouteStates";

export default function LeadsError({ reset }: RouteErrorBoundaryProps) {
  return <RouteErrorState title="Leads could not be loaded" reset={reset} />;
}
