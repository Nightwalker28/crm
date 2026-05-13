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
import { DASHBOARD_ROUTES, SETTINGS_ROUTES, getFriendlyRouteLabel } from "@/lib/routes";

const ADMIN_ONLY_PREFIXES = [
  SETTINGS_ROUTES.root,
  SETTINGS_ROUTES.general,
  SETTINGS_ROUTES.users,
  SETTINGS_ROUTES.teams,
  SETTINGS_ROUTES.permissions,
  SETTINGS_ROUTES.modules,
  SETTINGS_ROUTES.moduleBuilder,
  SETTINGS_ROUTES.fields,
  SETTINGS_ROUTES.integrations,
  SETTINGS_ROUTES.templates,
  SETTINGS_ROUTES.recycleBin,
  SETTINGS_ROUTES.activityLog,
  "/dashboard/views/admin_users",
];

const MODULE_ROUTE_PREFIXES = [
  "/dashboard/mail",
  "/dashboard/calendar",
  "/dashboard/tasks",
  DASHBOARD_ROUTES.insertionOrders,
  DASHBOARD_ROUTES.products,
  DASHBOARD_ROUTES.services,
  DASHBOARD_ROUTES.contacts,
  DASHBOARD_ROUTES.accounts,
  DASHBOARD_ROUTES.deals,
];

function isAdminOnlyPath(pathname: string) {
  return ADMIN_ONLY_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + "/"));
}

function matchedModuleRoute(pathname: string) {
  return MODULE_ROUTE_PREFIXES.find((prefix) => pathname === prefix || pathname.startsWith(prefix + "/")) ?? null;
}

function getBreadcrumbItems(pathname: string) {
  const segments = pathname.split("?")[0]?.split("/").filter(Boolean) ?? [];

  return segments.map((segment, index) => {
    const href = `/${segments.slice(0, index + 1).join("/")}`;
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
}

function BreadcrumbBar({ pathname }: { pathname: string }) {
  const items = getBreadcrumbItems(pathname);

  return (
    <nav className="flex min-w-0 items-center gap-1 text-sm text-neutral-500" aria-label="Breadcrumb">
      {items.map((item, index) => (
        <div key={item.href} className="flex min-w-0 items-center gap-1">
          {index > 0 ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-700" /> : null}
          {item.current ? (
            <span className="truncate font-medium text-neutral-200">{item.label}</span>
          ) : (
            <Link href={item.href} className="truncate transition-colors hover:text-neutral-200">
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
  const allowedModuleRoutes = new Set(modules.map((module) => module.base_route).filter(Boolean));
  const customModuleRoute = modules
    .map((module) => module.base_route)
    .filter((route): route is string => Boolean(route?.startsWith("/dashboard/custom/")))
    .find((route) => pathname === route || pathname.startsWith(route + "/"));
  const isCheckingAdminAccess = requiresAdmin && isLoading;
  const isCustomModulePath = pathname === "/dashboard/custom" || pathname.startsWith("/dashboard/custom/");
  const isCheckingModuleAccess = Boolean((moduleRoute || isCustomModulePath) && modulesLoading);
  const isCheckingAccess = isCheckingAdminAccess || isCheckingModuleAccess;
  const isBlocked = requiresAdmin && !isLoading && !isAdmin;
  const isModuleBlocked = Boolean(
    (moduleRoute && !modulesLoading && !allowedModuleRoutes.has(moduleRoute)) ||
      (isCustomModulePath && !modulesLoading && !customModuleRoute),
  );

  useEffect(() => {
    if (isBlocked || isModuleBlocked) {
      router.replace("/dashboard");
    }
  }, [isBlocked, isModuleBlocked, router]);

  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-neutral-950 text-neutral-200 font-sans">
      <BrowserNotificationsBridge />
      <CalendarSyncBridge />

      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-0 mix-blend-soft-light opacity-[0.3] bg-[linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px)] bg-size-[3px_3px]" />
      </div>

      <Sidebar />

      <main className="relative z-10 flex min-w-0 flex-1 overflow-hidden px-3 py-4 pr-4">
        <div className="relative z-20 flex h-full w-full min-w-0 flex-col overflow-hidden rounded-xl border border-white/6 bg-[#0a0a0a] shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
          <div className="flex flex-col gap-3 border-b border-white/6 px-6 py-4 xl:flex-row xl:items-center xl:justify-between">
            <BreadcrumbBar pathname={pathname} />
            <div className="w-full xl:max-w-xl">
              <GlobalCommandPalette />
            </div>
          </div>
          <div className="scrollbar-hide relative z-30 h-full w-full overflow-y-auto px-6 py-5">
            {isCheckingAccess ? (
              <div className="rounded-md border border-neutral-800 bg-neutral-950/70 px-4 py-6 text-sm text-neutral-500">
                Checking access...
              </div>
            ) : isBlocked || isModuleBlocked ? (
              <div className="rounded-md border border-red-900/70 bg-red-950/30 px-4 py-6 text-sm text-red-100">
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
