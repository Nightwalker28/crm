"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { SETTINGS_ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";

const SETTINGS_NAV_ITEMS = [
  { label: "General", href: SETTINGS_ROUTES.general },
  { label: "User Management", href: SETTINGS_ROUTES.users },
  { label: "Teams", href: SETTINGS_ROUTES.teams },
  { label: "Customer Groups", href: SETTINGS_ROUTES.customerGroups },
  { label: "Permissions", href: SETTINGS_ROUTES.permissions },
  { label: "Module Settings", href: SETTINGS_ROUTES.modules },
  { label: "Module Builder", href: SETTINGS_ROUTES.moduleBuilder },
  { label: "Field Config", href: SETTINGS_ROUTES.fields },
  { label: "Integrations", href: SETTINGS_ROUTES.integrations },
  { label: "Templates", href: SETTINGS_ROUTES.templates },
  { label: "Activity Log", href: SETTINGS_ROUTES.activityLog },
];

const DANGER_NAV_ITEMS = [
  { label: "Recycle Bin", href: SETTINGS_ROUTES.recycleBin },
];

function isActiveSettingsRoute(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="grid min-h-full gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-0 lg:self-start">
        <div className="scrollbar-hide overflow-x-auto overflow-y-hidden border-b border-neutral-800 pb-3 lg:overflow-visible lg:border-b-0 lg:border-r lg:pb-0 lg:pr-4">
          <nav className="flex min-w-max gap-1 lg:min-w-0 lg:flex-col" aria-label="Settings navigation">
            {SETTINGS_NAV_ITEMS.map((item) => {
              const active = isActiveSettingsRoute(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "border-white/20 bg-white/10 text-neutral-100"
                      : "border-transparent text-neutral-400 hover:border-white/10 hover:bg-white/[0.04] hover:text-neutral-100",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
            <div className="mt-2 border-t border-red-950/60 pt-2">
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-red-500/70">Danger Zone</div>
              {DANGER_NAV_ITEMS.map((item) => {
                const active = isActiveSettingsRoute(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "block rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "border-red-400/30 bg-red-950/30 text-red-100"
                        : "border-transparent text-red-300/80 hover:border-red-500/20 hover:bg-red-950/20 hover:text-red-100",
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>
      </aside>

      <section className="min-w-0">{children}</section>
    </div>
  );
}
