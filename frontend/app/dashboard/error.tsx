"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { RouteErrorState, type RouteErrorBoundaryProps } from "@/components/ui/RouteStates";

export default function DashboardError({ error, reset }: RouteErrorBoundaryProps) {
  // A rendering crash never reaches the server: report it from here (off without a DSN).
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return <RouteErrorState title="This page could not be loaded" reset={reset} />;
}
