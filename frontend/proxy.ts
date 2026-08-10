import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (process.env.NODE_ENV === "production" && pathname.startsWith("/e2e/")) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const hasAccessToken = request.cookies.get("lynk_access_token");
  const hasRefreshToken = request.cookies.get("lynk_refresh_token");

  if (pathname.startsWith("/dashboard") && !hasAccessToken && !hasRefreshToken) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  // Signing in is the login page's only job, so send an already-signed-in visitor onward.
  // Other /auth routes stay reachable with a session: /auth/callback still has to explain a
  // failed SSO attempt, and /auth/setup-password still has to accept a setup link.
  if (pathname === "/auth/login" && (hasAccessToken || hasRefreshToken)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/auth/:path*", "/e2e/:path*"],
};
