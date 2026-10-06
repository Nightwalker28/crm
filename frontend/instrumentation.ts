import * as Sentry from "@sentry/nextjs";

import { sentryOptions } from "@/lib/errorTracking";

export async function register() {
  Sentry.init(sentryOptions(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN));
}

// Server-rendering and route-handler errors.
export const onRequestError = Sentry.captureRequestError;
