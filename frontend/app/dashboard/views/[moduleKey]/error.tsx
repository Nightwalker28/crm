"use client";

import { RouteErrorState, type RouteErrorBoundaryProps } from "@/components/ui/RouteStates";

export default function ViewManagerError({ reset }: RouteErrorBoundaryProps) {
  return <RouteErrorState title="The view manager could not be loaded" reset={reset} />;
}
