"use client";

import { RouteErrorState, type RouteErrorBoundaryProps } from "@/components/ui/RouteStates";

export default function ContactsError({ reset }: RouteErrorBoundaryProps) {
  return <RouteErrorState title="Contacts could not be loaded" reset={reset} />;
}
