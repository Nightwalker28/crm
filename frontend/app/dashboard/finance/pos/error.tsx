"use client";

import { RouteErrorState, type RouteErrorBoundaryProps } from "@/components/ui/RouteStates";

export default function InvoicesError({ reset }: RouteErrorBoundaryProps) {
  return <RouteErrorState title="Unable to load invoices" reset={reset} />;
}
