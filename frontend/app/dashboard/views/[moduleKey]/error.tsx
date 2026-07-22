"use client";

import { RouteErrorState } from "@/components/ui/RouteStates";

export default function ErrorState({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteErrorState title="Unable to load the view manager" reset={reset} />;
}
