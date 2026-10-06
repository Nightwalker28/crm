import type { ComponentType } from "react";
import { CalendarDays, FileText, PackageSearch, ScrollText, ShoppingCart } from "lucide-react";

/**
 * The client portal's sections — one source, read by the rail and by the hub's metric
 * tiles (rebuild 5.8, ruling 1). It is the portal's `SETTINGS_NAV_GROUPS`, and it exists
 * for the same reason: `client/page.tsx` held this list privately, so the rail would have
 * been a second copy of it and the two would have drifted.
 *
 * `key` is the metric key the overview endpoint returns, so the hub can pair a count to a
 * section without a second mapping.
 */
export type ClientPortalSection = {
  key: string;
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
};

export const CLIENT_PORTAL_SECTIONS: ClientPortalSection[] = [
  { key: "quotes", label: "Quotes", href: "/client/quotes", icon: ScrollText },
  { key: "orders", label: "Orders", href: "/client/orders", icon: ShoppingCart },
  { key: "documents", label: "Documents", href: "/client/documents", icon: FileText },
  { key: "bookings", label: "Bookings", href: "/client/bookings", icon: CalendarDays },
  { key: "catalog", label: "Catalog", href: "/client/catalog", icon: PackageSearch },
];

export const CLIENT_PORTAL_ROUTES = {
  home: "/client",
  login: "/client/login",
  setup: "/client/setup",
} as const;

/**
 * Routes under `/client` that do **not** take the portal chrome.
 *
 * Two shapes, for two different reasons. The doors — `login` and `setup` — are pre-auth,
 * and a rail of destinations you cannot reach yet is a wall with handles drawn on it; they
 * take the auth atmosphere instead (§9, ruling 3). `pages/[token]` is a shared proposal
 * link rendered in the *tenant's* branding, with the tenant's logo, accent and company
 * name — Lynk's own rail across the top of it would be the wrong company's chrome.
 */
export function isPortalChromeRoute(pathname: string) {
  if (pathname === CLIENT_PORTAL_ROUTES.login || pathname.startsWith(`${CLIENT_PORTAL_ROUTES.login}/`)) return false;
  if (pathname === CLIENT_PORTAL_ROUTES.setup || pathname.startsWith(`${CLIENT_PORTAL_ROUTES.setup}/`)) return false;
  if (pathname.startsWith("/client/pages/")) return false;
  return true;
}
