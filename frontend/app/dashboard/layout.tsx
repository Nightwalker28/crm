"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Menu } from "lucide-react";
import CalendarSyncBridge from "@/components/calendar/CalendarSyncBridge";
import Sidebar from "@/components/sidebar/Sidebar";
import BrowserNotificationsBridge from "@/components/notifications/BrowserNotificationsBridge";
import GlobalCommandPalette from "@/components/search/GlobalCommandPalette";
import NotificationCenter from "@/components/notifications/NotificationCenter";
import { ProfileMenu } from "@/components/header/ProfileMenu";
import { HexagonBackground } from "@/components/ui/HexagonBackground";
import { PermissionDeniedState } from "@/components/ui/PermissionDeniedState";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetOverlay, SheetPortal, SheetTitle } from "@/components/ui/sheet";
import { useSidebarUser } from "@/hooks/useSidebarUser";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { getModuleDisplayName } from "@/lib/module-display";
import { getGuardedModuleRoutePrefixes, getRequiredModuleKeyForRoute, MODULE_REGISTRY, SETTINGS_NAV_ITEMS } from "@/lib/module-registry";
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

function getSettingsBreadcrumbItems(pathname: string) {
  const settingsSegments = pathname.slice(SETTINGS_ROUTES.root.length).split("/").filter(Boolean);
  const items: Array<{ href: string; label: string; current: boolean }> = [
    { href: SETTINGS_ROUTES.root, label: "Settings", current: settingsSegments.length === 0 },
  ];
  settingsSegments.forEach((segment, index) => {
    const href = `${SETTINGS_ROUTES.root}/${settingsSegments.slice(0, index + 1).join("/")}`;
    items.push({
      href,
      label: index > 0 && settingsSegments[index - 1] === "modules" && /^\d+$/.test(segment)
        ? "Access Settings"
        : getFriendlyRouteLabel(segment),
      current: index === settingsSegments.length - 1,
    });
  });
  return items;
}

function BreadcrumbBar({ pathname, settingsLeafLabel }: { pathname: string; settingsLeafLabel?: string }) {
  if (pathname === SETTINGS_ROUTES.root || pathname.startsWith(`${SETTINGS_ROUTES.root}/`)) {
    const items = getSettingsBreadcrumbItems(pathname);
    if (settingsLeafLabel && items.length > 1) items[items.length - 1].label = settingsLeafLabel;
    return (
      <nav className="flex min-w-0 items-center gap-1 text-sm text-copy-muted" aria-label="Breadcrumb">
        {items.map((item, index) => (
          <div key={item.href} className="flex min-w-0 items-center gap-1">
            {index > 0 ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-copy-disabled" /> : null}
            {item.current ? <h1 className="truncate text-sm font-semibold text-copy-primary" aria-current="page">{item.label}</h1> : <Link href={item.href} className="truncate rounded-sm transition-colors hover:text-copy-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{item.label}</Link>}
          </div>
        ))}
      </nav>
    );
  }
  const isTopLevelCustomModule = /^\/dashboard\/custom\/[^/]+$/.test(pathname);
  if (
    pathname === "/dashboard" ||
    MODULE_ROUTE_PREFIXES.includes(pathname) ||
    isTopLevelCustomModule ||
    pathname === "/dashboard/views" ||
    pathname.startsWith("/dashboard/views/")
  ) {
    return null;
  }
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

function HeaderLocation({ pathname, customModuleLabel, settingsLeafLabel }: { pathname: string; customModuleLabel?: string; settingsLeafLabel?: string }) {
  if (pathname === SETTINGS_ROUTES.root || pathname.startsWith(`${SETTINGS_ROUTES.root}/`)) {
    return <BreadcrumbBar pathname={pathname} settingsLeafLabel={settingsLeafLabel} />;
  }
  const moduleTitle = MODULE_REGISTRY.find((module) => module.route === pathname)?.label ?? customModuleLabel;
  if (pathname === DASHBOARD_ROUTES.home) return <h1 className="truncate text-sm font-semibold text-copy-primary">Dashboard</h1>;
  if (moduleTitle) return <h1 className="truncate text-sm font-semibold text-copy-primary">{moduleTitle}</h1>;
  return <BreadcrumbBar pathname={pathname} settingsLeafLabel={settingsLeafLabel} />;
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const { isAdmin, isLoading } = useSidebarUser();
  const { modules, isLoading: modulesLoading } = useAccessibleModules();
  const requiresAdmin = isAdminOnlyPath(pathname);
  const moduleRoute = matchedModuleRoute(pathname);
  const allowedModuleNames = new Set(modules.map((module) => module.name));
  const customModuleRoute = modules
    .map((module) => module.base_route)
    .filter((route): route is string => Boolean(route?.startsWith("/dashboard/custom/")))
    .find((route) => pathname === route || pathname.startsWith(route + "/"));
  const customModule = modules.find((module) => module.base_route === pathname);
  const customModuleLabel = customModule
    ? customModule.display_name?.trim() || getModuleDisplayName(customModule.name, customModule.description ?? undefined)
    : undefined;
  const settingsLeafLabel = pathname === SETTINGS_ROUTES.users && searchParams.get("tab") === "domains" ? "Domains & SSO" : undefined;
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
  }, [canonicalPathname, hasLegacyPathname, router]);

  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-app font-sans text-copy-secondary">
      <BrowserNotificationsBridge />
      <CalendarSyncBridge />

      <div className="pointer-events-none fixed inset-0 z-0">
        <HexagonBackground
          aria-hidden="true"
          hexagonMargin={5}
          hexagonSize={80}
          className="absolute inset-0 opacity-[0.32]"
        />
        <div className="absolute inset-0 bg-surface/68" />
        <div className="absolute inset-0 bg-[image:var(--background-accent-glow)]" />
      </div>

      <Sidebar />
      <Sheet open={mobileNavigationOpen} onOpenChange={setMobileNavigationOpen}>
        <SheetPortal>
          <SheetOverlay className="fixed inset-0 z-40 bg-overlay md:hidden" />
          <SheetContent side="left" className="z-50 w-72 max-w-[85vw] outline-none md:hidden">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <Sidebar mobile onNavigate={() => setMobileNavigationOpen(false)} />
          </SheetContent>
        </SheetPortal>
      </Sheet>

      <main className="relative z-10 flex min-w-0 flex-1 overflow-hidden">
        <div className="relative z-20 flex h-full w-full min-w-0 flex-col overflow-hidden bg-transparent">
          <header className="relative z-10 grid min-h-16 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-line-subtle px-4 py-3 sm:px-6 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,34rem)_minmax(0,1fr)] xl:py-0">
            <div className="flex min-w-0 items-center gap-2">
              <Button type="button" variant="ghost" size="icon-sm" className="md:hidden" aria-label="Open navigation" aria-expanded={mobileNavigationOpen} onClick={() => setMobileNavigationOpen(true)}><Menu /></Button>
              <HeaderLocation pathname={pathname} customModuleLabel={customModuleLabel} settingsLeafLabel={settingsLeafLabel} />
            </div>
            <div className="min-w-0">
              <GlobalCommandPalette responsive />
            </div>
            <div className="flex items-center justify-end gap-2">
              <NotificationCenter />
              <ProfileMenu />
            </div>
          </header>
          <div className="scrollbar-hide relative z-30 h-full w-full overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
            {isCheckingAccess ? (
              <div className="rounded-[var(--radius-card)] border border-line-subtle bg-surface-muted px-4 py-6 text-sm text-copy-muted">
                Checking access...
              </div>
            ) : isBlocked || isModuleBlocked ? (
              <PermissionDeniedState />
            ) : (
              children
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
