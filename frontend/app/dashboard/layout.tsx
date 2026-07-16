"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import CalendarSyncBridge from "@/components/calendar/CalendarSyncBridge";
import Sidebar from "@/components/sidebar/Sidebar";
import BrowserNotificationsBridge from "@/components/notifications/BrowserNotificationsBridge";
import GlobalCommandPalette from "@/components/search/GlobalCommandPalette";
import { useSidebarUser } from "@/hooks/useSidebarUser";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { getGuardedModuleRoutePrefixes, getRequiredModuleKeyForRoute, SETTINGS_NAV_ITEMS } from "@/lib/module-registry";
import { DASHBOARD_ROUTES, SETTINGS_ROUTES, canonicalizeDashboardHref, getFriendlyRouteLabel } from "@/lib/routes";

const ADMIN_ONLY_PREFIXES = [
  SETTINGS_ROUTES.root,
  ...SETTINGS_NAV_ITEMS.map((item) => item.href),
  "/dashboard/views/admin_users",
];

const MODULE_ROUTE_PREFIXES = getGuardedModuleRoutePrefixes();

function isAdminOnlyPath(pathname: string) {
  return ADMIN_ONLY_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + "/"));
}

function matchedModuleRoute(pathname: string) {
  return MODULE_ROUTE_PREFIXES.find((prefix) => pathname === prefix || pathname.startsWith(prefix + "/")) ?? null;
}

function getBreadcrumbItems(pathname: string) {
  const segments = pathname.split("?")[0]?.split("/").filter(Boolean) ?? [];

  const items = segments.map((segment, index) => {
    const rawHref = `/${segments.slice(0, index + 1).join("/")}`;
    const href =
      rawHref === "/dashboard/sales"
        ? DASHBOARD_ROUTES.accounts
        : rawHref === "/dashboard/finance"
          ? DASHBOARD_ROUTES.financePos
          : rawHref === "/dashboard/catalog"
            ? DASHBOARD_ROUTES.products
            : rawHref;
    const previousSegment = segments[index - 1];
    const label =
      segment === "dashboard"
        ? "Dashboard"
        : previousSegment === "modules" && /^\d+$/.test(segment)
          ? "Access Settings"
          : getFriendlyRouteLabel(segment);

    return {
      href,
      label,
      current: index === segments.length - 1,
    };
  });

  return items.filter((item, index) => item.href !== items[index + 1]?.href);
}

function BreadcrumbBar({ pathname }: { pathname: string }) {
  const items = getBreadcrumbItems(pathname);

  return (
    <nav className="flex min-w-0 items-center gap-1 text-sm text-copy-muted" aria-label="Breadcrumb">
      {items.map((item, index) => (
        <div key={item.href} className="flex min-w-0 items-center gap-1">
          {index > 0 ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-copy-disabled" /> : null}
          {item.current ? (
            <span className="truncate font-medium text-copy-primary" aria-current="page">{item.label}</span>
          ) : (
            <Link href={item.href} className="truncate rounded-sm transition-colors hover:text-copy-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              {item.label}
            </Link>
          )}
        </div>
      ))}
    </nav>
  );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAdmin, isLoading } = useSidebarUser();
  const { modules, isLoading: modulesLoading } = useAccessibleModules();
  const requiresAdmin = isAdminOnlyPath(pathname);
  const moduleRoute = matchedModuleRoute(pathname);
  const allowedModuleNames = new Set(modules.map((module) => module.name));
  const customModuleRoute = modules
    .map((module) => module.base_route)
    .filter((route): route is string => Boolean(route?.startsWith("/dashboard/custom/")))
    .find((route) => pathname === route || pathname.startsWith(route + "/"));
  const isCheckingAdminAccess = requiresAdmin && isLoading;
  const isCustomModulePath = pathname === "/dashboard/custom" || pathname.startsWith("/dashboard/custom/");
  const isCheckingModuleAccess = Boolean((moduleRoute || isCustomModulePath) && modulesLoading);
  const isCheckingAccess = isCheckingAdminAccess || isCheckingModuleAccess;
  const isBlocked = requiresAdmin && !isLoading && !isAdmin;
  const canonicalPathname = canonicalizeDashboardHref(pathname);
  const hasLegacyPathname = canonicalPathname !== pathname;
  const isModuleBlocked = Boolean(
    (moduleRoute && !modulesLoading && !allowedModuleNames.has(getRequiredModuleKeyForRoute(moduleRoute) ?? "")) ||
      (isCustomModulePath && !modulesLoading && !customModuleRoute),
  );

  useEffect(() => {
    if (hasLegacyPathname) {
      router.replace(canonicalPathname);
      return;
    }
    if (isBlocked || isModuleBlocked) {
      router.replace("/dashboard");
    }
  }, [canonicalPathname, hasLegacyPathname, isBlocked, isModuleBlocked, router]);

  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-app font-sans text-copy-secondary">
      <BrowserNotificationsBridge />
      <CalendarSyncBridge />

      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(108,124,255,0.08),transparent_38%)]" />
      </div>

      <Sidebar />

      <main className="relative z-10 flex min-w-0 flex-1 overflow-hidden p-3 sm:p-4 lg:p-6">
        <div className="relative z-20 flex h-full w-full min-w-0 flex-col overflow-hidden rounded-[var(--radius-panel)] border border-line-subtle bg-surface shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
          <div className="flex min-h-16 flex-col justify-center gap-3 border-b border-line-subtle px-4 py-3 sm:px-6 xl:flex-row xl:items-center xl:justify-between xl:py-0">
            <BreadcrumbBar pathname={pathname} />
            <div className="w-full xl:max-w-xl">
              <GlobalCommandPalette />
            </div>
          </div>
          <div className="scrollbar-hide relative z-30 h-full w-full overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
            {isCheckingAccess ? (
              <div className="rounded-[var(--radius-card)] border border-line-subtle bg-surface-muted px-4 py-6 text-sm text-copy-muted">
                Checking access...
              </div>
            ) : isBlocked || isModuleBlocked ? (
              <div className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-6 text-sm text-copy-primary">
                You do not have access to open this page.
              </div>
            ) : (
              children
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
