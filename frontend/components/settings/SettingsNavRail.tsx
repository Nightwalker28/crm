"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { navItemClassName } from "@/components/sidebar/SidebarNav";
import { SETTINGS_NAV_GROUPS } from "@/lib/module-registry";
import { SETTINGS_ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";

/**
 * Lateral navigation inside settings — the whole of A8.
 *
 * Before this, `settings/layout.tsx` was a five-line passthrough and the hub was the only
 * index, so *any* two-page settings task round-tripped through it: Users → hub → Teams →
 * hub → Permissions. The rail is the fix, and it renders `SETTINGS_NAV_GROUPS` — the same
 * single source the hub and the command palette read (rebuild.md 5.6, ruling 2).
 *
 * The active treatment is the sidebar's, and it is the same class rather than a copy of it
 * (design.md §7.16): a second nav in the same viewport that marked its position a different
 * way would read as a different kind of thing, and the copy is how the two would drift.
 */
export function SettingsNavRail({ className }: { className?: string }) {
  const pathname = usePathname();

  return (
    <nav
      data-slot="settings-nav-rail"
      aria-label="Settings"
      className={cn("flex min-w-0 flex-col gap-6", className)}
    >
      <SettingsNavLink
        href={SETTINGS_ROUTES.root}
        label="All settings"
        active={pathname === SETTINGS_ROUTES.root}
      />
      {SETTINGS_NAV_GROUPS.map((group) => (
        <div key={group.key} className="flex min-w-0 flex-col gap-1">
          {/* §3.3: a group marker, not a heading — the page's one h1 is the surface title
              `PageShell` renders in the column beside this. §3.5 forbids the `uppercase
              tracking-wide` this first reached for: the size and ink step already mark it,
              and shouting a nav label is the one thing a quiet rail must not do. */}
          <div className="px-2 text-2xs font-semibold text-copy-label">
            {group.title}
          </div>
          {group.items.map((item) => (
            <SettingsNavLink
              key={item.href}
              href={item.href}
              label={item.label}
              // `startsWith` so `modules/[moduleId]` keeps Module Settings marked, but
              // guarded by the separator or `/dashboard/settings/module-builder` would
              // light up `/dashboard/settings/modules` as well.
              active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
            />
          ))}
        </div>
      ))}
    </nav>
  );
}

function SettingsNavLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={navItemClassName(active)}
    >
      <span className="min-w-0 truncate">{label}</span>
    </Link>
  );
}
