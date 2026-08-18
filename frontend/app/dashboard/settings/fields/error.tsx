"use client";

import { RouteErrorState, type RouteErrorBoundaryProps } from "@/components/ui/RouteStates";

export default function FieldConfigError({ reset }: RouteErrorBoundaryProps) {
  return <RouteErrorState title="Unable to load field configuration" reset={reset} />;
}
