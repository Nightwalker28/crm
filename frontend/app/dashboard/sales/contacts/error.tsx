"use client";

import { RouteErrorState, type RouteErrorBoundaryProps } from "@/components/ui/RouteStates";

export default function ContactsError({ reset }: RouteErrorBoundaryProps) {
  return <RouteErrorState title="Unable to load contacts" reset={reset} />;
}
