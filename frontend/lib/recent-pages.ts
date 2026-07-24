import type { AccessibleModule } from "@/hooks/useAccessibleModules";
import { getModuleDisplayName } from "@/lib/module-display";
import { getModuleRoute, SETTINGS_NAV_ITEMS } from "@/lib/module-registry";
import { canonicalizeDashboardHref, getFriendlyRouteLabel } from "@/lib/routes";

const RECENT_PAGES_KEY_PREFIX = "lynk:command-palette:recent-pages";
const RECENT_PAGES_CHANGED_EVENT = "lynk:recent-pages-changed";
const RECENT_PAGE_LIMIT = 6;

export type RecentPage = {
  label: string;
  subtitle: string;
  href: string;
};

function storageKey(userId: number) {
  return `${RECENT_PAGES_KEY_PREFIX}:${userId}`;
}

function isRecentPage(value: unknown): value is RecentPage {
  if (!value || typeof value !== "object") return false;
  const page = value as Partial<RecentPage>;
  return (
    typeof page.label === "string" &&
    typeof page.subtitle === "string" &&
    typeof page.href === "string" &&
    page.href.startsWith("/dashboard")
  );
}

export function parseRecentPages(snapshot: string): RecentPage[] {
  try {
    const parsed = JSON.parse(snapshot);
    return Array.isArray(parsed) ? parsed.filter(isRecentPage).slice(0, RECENT_PAGE_LIMIT) : [];
  } catch {
    return [];
  }
}

export function getRecentPagesSnapshot(userId?: number | null) {
  if (typeof window === "undefined" || !userId) return "[]";
  return window.localStorage.getItem(storageKey(userId)) ?? "[]";
}

export function subscribeToRecentPages(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith(RECENT_PAGES_KEY_PREFIX)) onStoreChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(RECENT_PAGES_CHANGED_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(RECENT_PAGES_CHANGED_EVENT, onStoreChange);
  };
}

export function recordRecentPage(userId: number, page: RecentPage) {
  if (typeof window === "undefined") return;
  const current = parseRecentPages(getRecentPagesSnapshot(userId));
  const next = [page, ...current.filter((item) => item.href !== page.href)].slice(0, RECENT_PAGE_LIMIT);
  window.localStorage.setItem(storageKey(userId), JSON.stringify(next));
  window.dispatchEvent(new Event(RECENT_PAGES_CHANGED_EVENT));
}

function singularize(label: string) {
  const irregular: Record<string, string> = {
    Accounts: "account",
    "Support Cases": "support case",
    "Insertion Orders": "insertion order",
  };
  if (irregular[label]) return irregular[label];
  return label.endsWith("s") ? label.slice(0, -1).toLowerCase() : label.toLowerCase();
}

export function describeRecentDashboardPage(
  pathname: string,
  modules: AccessibleModule[],
  isAdmin: boolean,
): RecentPage | null {
  const href = canonicalizeDashboardHref(pathname);
  if (href === "/dashboard" || !href.startsWith("/dashboard/")) return null;

  const setting = SETTINGS_NAV_ITEMS.find((item) => item.href === href);
  if (setting) {
    if (!isAdmin) return null;
    return { label: setting.label, subtitle: "Settings", href };
  }
  if (href === "/dashboard/settings") {
    if (!isAdmin) return null;
    return { label: "Settings", subtitle: "Workspace settings", href };
  }
  if (href === "/dashboard/profile") {
    return { label: "Profile", subtitle: "Your account", href };
  }

  const moduleMatch = modules
    .map((module) => ({
      module,
      route: getModuleRoute(module.name, module.base_route),
    }))
    .filter((item) => item.route && (href === item.route || href.startsWith(`${item.route}/`)))
    .sort((left, right) => right.route.length - left.route.length)[0];

  if (moduleMatch) {
    const moduleLabel = getModuleDisplayName(
      moduleMatch.module.name,
      moduleMatch.module.description ?? undefined,
    );
    if (href === moduleMatch.route) {
      return { label: moduleLabel, subtitle: "Module", href };
    }

    const segments = href.split("/").filter(Boolean);
    const tail = segments[segments.length - 1] ?? "";
    const recordLabel = singularize(moduleLabel);
    if (tail === "new") return { label: `Create ${recordLabel}`, subtitle: moduleLabel, href };
    if (tail === "edit") return { label: `Edit ${recordLabel}`, subtitle: moduleLabel, href };
    if (tail === "convert") return { label: `Convert ${recordLabel}`, subtitle: moduleLabel, href };
    if (tail === "print") return { label: `Print ${recordLabel}`, subtitle: moduleLabel, href };
    if (/^\d+$/.test(tail)) return { label: `${moduleLabel} details`, subtitle: moduleLabel, href };
    return { label: getFriendlyRouteLabel(tail), subtitle: moduleLabel, href };
  }

  return null;
}
