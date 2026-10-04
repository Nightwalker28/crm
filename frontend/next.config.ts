import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

type RemotePattern = { protocol: "http" | "https"; hostname: string; port?: string };

/** The API's origin, from which profile photos and media are served (13 E13). */
function apiImagePattern(): RemotePattern[] {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return [];
  try {
    const url = new URL(base);
    return [{ protocol: url.protocol === "https:" ? "https" : "http", hostname: url.hostname, ...(url.port ? { port: url.port } : {}) }];
  } catch {
    return [];
  }
}

// Every response. The Content-Security-Policy, which needs a nonce per request, is set in
// proxy.ts (13 F0.7 B2).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // Browsers ignore it over plain HTTP, so local development is unaffected.
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  images: {
    remotePatterns: [
      ...apiImagePattern(),
      { protocol: "http", hostname: "localhost" },
      { protocol: "http", hostname: "127.0.0.1" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" }, // Google profile images
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  telemetry: false,
  // Source maps upload only when the build is given a token for the error tracker.
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
