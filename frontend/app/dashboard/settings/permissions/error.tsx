"use client";

import { RouteErrorState, type RouteErrorBoundaryProps } from "@/components/ui/RouteStates";

export default function PermissionsError({ reset }: RouteErrorBoundaryProps) {
  return <RouteErrorState title="Unable to load roles and permissions" reset={reset} />;
}
