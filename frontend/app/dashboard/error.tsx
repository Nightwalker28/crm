"use client";

import { RouteErrorState } from "@/components/ui/RouteStates";

export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteErrorState title="Unable to load this dashboard page" reset={reset} />;
}
