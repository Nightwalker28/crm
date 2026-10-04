import * as Sentry from "@sentry/nextjs";

import { sentryOptions } from "@/lib/errorTracking";

Sentry.init(sentryOptions(process.env.NEXT_PUBLIC_SENTRY_DSN));

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
