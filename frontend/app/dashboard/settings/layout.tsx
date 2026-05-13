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
  { label: "Permissions", href: SETTINGS_ROUTES.permissions },
  { label: "Module Settings", href: SETTINGS_ROUTES.modules },
  { label: "Module Builder", href: SETTINGS_ROUTES.moduleBuilder },
  { label: "Field Config", href: SETTINGS_ROUTES.fields },
  { label: "Integrations", href: SETTINGS_ROUTES.integrations },
  { label: "Templates", href: SETTINGS_ROUTES.templates },
  { label: "Recycle Bin", href: SETTINGS_ROUTES.recycleBin },
  { label: "Activity Log", href: SETTINGS_ROUTES.activityLog },
];

function isActiveSettingsRoute(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="grid min-h-full gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-0 lg:self-start">
        <div className="overflow-x-auto border-b border-neutral-800 pb-3 lg:overflow-visible lg:border-b-0 lg:border-r lg:pb-0 lg:pr-4">
          <nav className="flex min-w-max gap-1 lg:min-w-0 lg:flex-col" aria-label="Settings navigation">
            <Link
              href={SETTINGS_ROUTES.root}
              className={cn(
                "rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                pathname === SETTINGS_ROUTES.root
                  ? "border-white/20 bg-white/10 text-neutral-100"
                  : "border-transparent text-neutral-400 hover:border-white/10 hover:bg-white/[0.04] hover:text-neutral-100",
              )}
            >
              Settings Overview
            </Link>
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
          </nav>
        </div>
      </aside>

      <section className="min-w-0">{children}</section>
    </div>
  );
}
