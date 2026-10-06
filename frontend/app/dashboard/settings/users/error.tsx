"use client";

import { RouteErrorState, type RouteErrorBoundaryProps } from "@/components/ui/RouteStates";

export default function UsersError({ reset }: RouteErrorBoundaryProps) {
  return <RouteErrorState title="User management could not be loaded" reset={reset} />;
}
