"use client";

import { RouteErrorState, type RouteErrorBoundaryProps } from "@/components/ui/RouteStates";

export default function ViewManagerError({ reset }: RouteErrorBoundaryProps) {
  return <RouteErrorState title="Unable to load the view manager" reset={reset} />;
}
