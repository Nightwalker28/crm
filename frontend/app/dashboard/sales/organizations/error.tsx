"use client";

import { RouteErrorState, type RouteErrorBoundaryProps } from "@/components/ui/RouteStates";

export default function OrganizationsError({ reset }: RouteErrorBoundaryProps) {
  return <RouteErrorState title="Unable to load accounts" reset={reset} />;
}
