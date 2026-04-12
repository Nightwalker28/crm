import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const hasAccessToken = request.cookies.get("lynk_access_token");
  const hasRefreshToken = request.cookies.get("lynk_refresh_token");

  if (pathname.startsWith("/dashboard") && !hasAccessToken && !hasRefreshToken) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  if (pathname.startsWith("/auth") && (hasAccessToken || hasRefreshToken)) {
    return NextResponse.redirect(new URL("/dashboard/users", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/auth/:path*"],
};
