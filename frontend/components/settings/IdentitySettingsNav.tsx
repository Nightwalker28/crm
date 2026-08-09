"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { SETTINGS_ROUTES } from "@/lib/routes";

const items = [
  { href: SETTINGS_ROUTES.users, label: "Users" },
  { href: SETTINGS_ROUTES.authentication, label: "Authentication" },
  { href: SETTINGS_ROUTES.domains, label: "Domains" },
  { href: SETTINGS_ROUTES.provisioning, label: "Provisioning" },
] as const;

export function IdentitySettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="User and access settings" className="flex max-w-full gap-1 overflow-x-auto border-b border-line-default pb-2">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={pathname === item.href ? "page" : undefined}
          className="shrink-0 rounded-control px-3 py-2 text-sm font-medium text-copy-secondary outline-none hover:bg-surface-hover hover:text-copy-primary focus-visible:ring-2 focus-visible:ring-primary aria-[current=page]:bg-action-primary-muted aria-[current=page]:text-action-primary"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
