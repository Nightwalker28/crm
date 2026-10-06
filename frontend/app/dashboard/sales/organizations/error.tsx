"use client";

import { RouteErrorState, type RouteErrorBoundaryProps } from "@/components/ui/RouteStates";

export default function OrganizationsError({ reset }: RouteErrorBoundaryProps) {
  return <RouteErrorState title="Accounts could not be loaded" reset={reset} />;
}
