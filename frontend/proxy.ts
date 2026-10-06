import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { loginPathFor, safeNextPath } from "@/lib/authRedirect";
import { serverEnv } from "@/lib/serverEnv";

function originOf(value: string | undefined): string {
  if (!value) return "";
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

/**
 * The Content-Security-Policy, with a fresh nonce per request (13 F0.7 B2). Next.js reads the
 * nonce from this header on the request and stamps it on its own scripts; the root layout
 * passes it to `runtime-config.js` and next-themes' inline script. 'strict-dynamic' lets
 * those scripts load the chunks they need and nothing else. Styles stay 'unsafe-inline':
 * React and Radix set style attributes, and a style cannot run code.
 */
function contentSecurityPolicy(nonce: string) {
  const isDev = process.env.NODE_ENV !== "production";
  // Read per request: the same image runs against different API origins (lib/serverEnv.ts).
  const apiOrigin = originOf(serverEnv("NEXT_PUBLIC_API_BASE_URL"));
  const sentryOrigin = originOf(serverEnv("NEXT_PUBLIC_SENTRY_DSN"));
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: https: ${apiOrigin}`.trim(),
    "font-src 'self' data:",
    `connect-src 'self' ${apiOrigin} ${sentryOrigin}${isDev ? " ws: wss:" : ""}`.replace(/\s+/g, " ").trim(),
    `frame-src 'self' blob: ${apiOrigin}`.trim(),
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self' ${apiOrigin}`.trim(),
    "frame-ancestors 'none'",
  ];
  return directives.join("; ");
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (process.env.NODE_ENV === "production" && pathname.startsWith("/e2e/")) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const hasAccessToken = request.cookies.get("lynk_access_token");
  const hasRefreshToken = request.cookies.get("lynk_refresh_token");

  if (pathname.startsWith("/dashboard") && !hasAccessToken && !hasRefreshToken) {
    // Keep the deep link: sign-in comes back here (13a I2).
    return NextResponse.redirect(new URL(loginPathFor(`${pathname}${search}`), request.url));
  }

  // Signing in is the login page's only job, so send an already-signed-in visitor onward.
  // Other /auth routes stay reachable with a session: /auth/callback still has to explain a
  // failed SSO attempt, and /auth/setup-password still has to accept a setup link.
  if (pathname === "/auth/login" && (hasAccessToken || hasRefreshToken)) {
    return NextResponse.redirect(new URL(safeNextPath(request.nextUrl.searchParams.get("next")), request.url));
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      // Every page; not static assets, images or prefetches (which reuse the page's policy).
      source: "/((?!api|_next/static|_next/image|favicon.ico|runtime-config.js|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|txt|xml|woff2?)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
