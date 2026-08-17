"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Menu } from "lucide-react";
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
import { getGuardedModuleRoutePrefixes, getModuleRegistryLabel, getRequiredModuleKeyForRoute, MODULE_REGISTRY, SETTINGS_NAV_ITEMS } from "@/lib/module-registry";
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

function registryModuleTitle(pathname: string) {
  return [...MODULE_REGISTRY]
    .sort((left, right) => right.route.length - left.route.length)
    .find((module) => pathname === module.route || pathname.startsWith(`${module.route}/`))
    ?.label;
}

// The sidebar carries a single flat "Settings" entry that opens the settings landing page.
// Once a specific settings page is open, the header names that page, using the same label the
// sidebar and landing page use so the name you click is the name you land on.
function settingsPageTitle(pathname: string) {
  const segments = pathname.slice(SETTINGS_ROUTES.root.length).split("/").filter(Boolean);
  const leaf = segments[segments.length - 1];
  if (!leaf) return "Settings";
  if (segments.length > 1 && segments[segments.length - 2] === "modules" && /^\d+$/.test(leaf)) {
    return "Access Settings";
  }

  const navItem = [...SETTINGS_NAV_ITEMS]
    .sort((left, right) => right.href.length - left.href.length)
    .find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));

  return navItem?.label ?? getFriendlyRouteLabel(leaf);
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
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
  const customModule = customModuleRoute ? modules.find((module) => module.base_route === customModuleRoute) : undefined;
  const viewModuleKey = pathname.startsWith("/dashboard/views/") ? pathname.split("/")[3] : null;
  const moduleTitle = pathname === DASHBOARD_ROUTES.home
    ? "Dashboard"
    : pathname === SETTINGS_ROUTES.root || pathname.startsWith(`${SETTINGS_ROUTES.root}/`)
      ? settingsPageTitle(pathname)
      : pathname === "/dashboard/profile"
        ? "Profile"
        : viewModuleKey
          ? getModuleRegistryLabel(viewModuleKey) ?? "View Manager"
          : registryModuleTitle(pathname) ?? (customModule
            ? customModule.display_name?.trim() || getModuleDisplayName(customModule.name, customModule.description ?? undefined)
            : null);
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
              {/* Not an h1: this names the *module*, and `PageHeader` names the page (§8 —
                  exactly one per page). It was an h1 until every route carried a `PageShell`,
                  because demoting it sooner would have left the unmigrated pages with no
                  heading at all. Phase 4 finished that migration. */}
              {moduleTitle ? <div className="truncate text-sm font-semibold text-copy-primary">{moduleTitle}</div> : null}
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
              <div className="rounded-[var(--radius-card)] border border-line-default bg-surface-muted px-4 py-6 text-sm text-copy-muted">
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
