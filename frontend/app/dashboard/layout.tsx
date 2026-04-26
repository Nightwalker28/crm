"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import CalendarSyncBridge from "@/components/calendar/CalendarSyncBridge";
import Sidebar from "@/components/sidebar/Sidebar";
import BrowserNotificationsBridge from "@/components/notifications/BrowserNotificationsBridge";
import GlobalCommandPalette from "@/components/search/GlobalCommandPalette";
import { useSidebarUser } from "@/hooks/useSidebarUser";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";

const ADMIN_ONLY_PREFIXES = [
  "/dashboard/users",
  "/dashboard/user/teams",
  "/dashboard/company",
  "/dashboard/roles-permissions",
  "/dashboard/custom-fields",
  "/dashboard/modules",
  "/dashboard/recycle-bin",
  "/dashboard/activity-log",
  "/dashboard/views/admin_users",
];

const MODULE_ROUTE_PREFIXES = [
  "/dashboard/mail",
  "/dashboard/calendar",
  "/dashboard/tasks",
  "/dashboard/finance/insertion-orders",
  "/dashboard/sales/contacts",
  "/dashboard/sales/organizations",
  "/dashboard/sales/opportunities",
];

function isAdminOnlyPath(pathname: string) {
  return ADMIN_ONLY_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + "/"));
}

function matchedModuleRoute(pathname: string) {
  return MODULE_ROUTE_PREFIXES.find((prefix) => pathname === prefix || pathname.startsWith(prefix + "/")) ?? null;
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAdmin, isLoading } = useSidebarUser();
  const { modules, isLoading: modulesLoading } = useAccessibleModules();
  const requiresAdmin = isAdminOnlyPath(pathname);
  const moduleRoute = matchedModuleRoute(pathname);
  const allowedModuleRoutes = new Set(modules.map((module) => module.base_route).filter(Boolean));
  const isBlocked = requiresAdmin && !isLoading && !isAdmin;
  const isModuleBlocked = Boolean(moduleRoute && !modulesLoading && !allowedModuleRoutes.has(moduleRoute));

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
          <div className="border-b border-white/6 px-6 py-4">
            <GlobalCommandPalette />
          </div>
          <div className="relative z-30 h-full w-full overflow-y-auto px-6 py-5 custom-scrollbar">
            {(requiresAdmin && isLoading) || (moduleRoute && modulesLoading) ? (
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
