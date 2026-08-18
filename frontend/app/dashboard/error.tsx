"use client";

import { RouteErrorState, type RouteErrorBoundaryProps } from "@/components/ui/RouteStates";

export default function DashboardError({ reset }: RouteErrorBoundaryProps) {
  return <RouteErrorState title="Unable to load this dashboard page" reset={reset} />;
}
