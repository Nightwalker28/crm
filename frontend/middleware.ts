import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const hasAccessToken = request.cookies.get("lynk_access_token");
  const hasRefreshToken = request.cookies.get("lynk_refresh_token");

  // Protect dashboard routes
  if (pathname.startsWith("/dashboard") && !hasAccessToken && !hasRefreshToken) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  // Prevent logged-in users from visiting auth pages
  if (pathname.startsWith("/auth") && (hasAccessToken || hasRefreshToken)) {
    return NextResponse.redirect(new URL("/dashboard/users", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/auth/:path*"],
};
