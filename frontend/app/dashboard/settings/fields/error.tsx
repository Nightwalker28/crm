"use client";

import { RouteErrorState, type RouteErrorBoundaryProps } from "@/components/ui/RouteStates";

export default function FieldConfigError({ reset }: RouteErrorBoundaryProps) {
  return <RouteErrorState title="Field configuration could not be loaded" reset={reset} />;
}
