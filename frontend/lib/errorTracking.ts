/**
 * Shared Sentry options for the browser, the Node server and the edge (13 F0.8 F1). Error
 * tracking is off unless NEXT_PUBLIC_SENTRY_DSN (or SENTRY_DSN on the server) is set at
 * build time; any Sentry-compatible service works. No personal data is sent: no cookies,
 * no request bodies, no IP addresses.
 */
export function sentryOptions(dsn: string | undefined) {
  return {
    dsn,
    enabled: Boolean(dsn),
    environment: process.env.NEXT_PUBLIC_APP_ENVIRONMENT || process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_APP_VERSION || undefined,
    sendDefaultPii: false,
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || 0),
  };
}
