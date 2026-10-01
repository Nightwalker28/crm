"use client";

import { RouteErrorState, type RouteErrorBoundaryProps } from "@/components/ui/RouteStates";

export default function DashboardError({ reset }: RouteErrorBoundaryProps) {
  return <RouteErrorState title="This page could not be loaded" reset={reset} />;
}
