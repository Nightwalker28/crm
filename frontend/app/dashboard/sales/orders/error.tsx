"use client";

import { RouteErrorState, type RouteErrorBoundaryProps } from "@/components/ui/RouteStates";

export default function OrdersError({ reset }: RouteErrorBoundaryProps) {
  return <RouteErrorState title="Unable to load orders" reset={reset} />;
}
