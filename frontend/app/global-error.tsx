"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { RouteErrorState, type RouteErrorBoundaryProps } from "@/components/ui/RouteStates";
import "./globals.css";

/**
 * The last boundary (13 F0.8 F5): a crash in the root layout itself. It replaces the whole
 * document, so it brings its own html, body and stylesheet; the theme class is gone with the
 * layout, and :root is the dark set.
 */
export default function GlobalError({ error, reset }: RouteErrorBoundaryProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-app font-sans antialiased">
        <main className="mx-auto max-w-xl px-6 py-16">
          <RouteErrorState
            title="Lynk could not load"
            description={`Reload to try again. If it keeps happening, quote this reference: ${error.digest ?? "none"}.`}
            reset={reset}
          />
        </main>
      </body>
    </html>
  );
}
