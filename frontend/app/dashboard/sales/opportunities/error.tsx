"use client";

import { RouteErrorState, type RouteErrorBoundaryProps } from "@/components/ui/RouteStates";

export default function OpportunitiesError({ reset }: RouteErrorBoundaryProps) {
  return <RouteErrorState title="Unable to load deals" reset={reset} />;
}
