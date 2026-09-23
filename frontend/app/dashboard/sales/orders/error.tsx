"use client";

import { RouteErrorState, type RouteErrorBoundaryProps } from "@/components/ui/RouteStates";

export default function OrdersError({ reset }: RouteErrorBoundaryProps) {
  return <RouteErrorState title="Orders could not be loaded" reset={reset} />;
}
