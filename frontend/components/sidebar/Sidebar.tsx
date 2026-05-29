"use client";

import { useMemo, useState, useSyncExternalStore, type ComponentType } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  BriefcaseBusiness,
  Boxes,
  Landmark,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  Wrench,
  LifeBuoy,
} from "lucide-react";
import { usePathname } from "next/navigation";

import NotificationCenter from "@/components/notifications/NotificationCenter";
import { useAccessibleModules, type AccessibleModule } from "@/hooks/useAccessibleModules";
import { useSidebarUser } from "@/hooks/useSidebarUser";
import { getModuleDisplayName } from "@/lib/module-display";
import { DASHBOARD_ROUTES, SETTINGS_ROUTES } from "@/lib/routes";
import { resolveMediaUrl } from "@/lib/media";

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItemChild,
  SidebarMenuItemCollapsible,
  SidebarNav,
} from "./SidebarNav";

const SIDEBAR_COLLAPSE_KEY = "lynk:sidebar-collapsed";
const SIDEBAR_COLLAPSE_EVENT = "lynk:sidebar-collapsed-change";
const HIDDEN_SIDEBAR_TAB_KEY = "none";

type SidebarGroupConfig = {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  sortOrder: number;
  items: Array<{ href: string; label: string; moduleName?: string }>;
};

const SYSTEM_GROUPS: Record<string, Omit<SidebarGroupConfig, "items">> = {
  sales: { key: "sales", label: "Sales", icon: BriefcaseBusiness, sortOrder: 10 },
  finance: { key: "finance", label: "Finance", icon: Landmark, sortOrder: 20 },
  catalog: { key: "catalog", label: "Products & Services", icon: Boxes, sortOrder: 30 },
  other: { key: "other", label: "Other", icon: Wrench, sortOrder: 100 },
  support: { key: "support", label: "Support", icon: LifeBuoy, sortOrder: 40 },
  settings: { key: "settings", label: "Settings", icon: Settings2, sortOrder: 90 },
};

const MODULE_ITEM_ORDER: Record<string, number> = {
  sales_leads: 10,
  sales_organizations: 20,
  sales_contacts: 30,
  sales_opportunities: 40,
  sales_quotes: 50,
  sales_orders: 60,
  contracts: 70,
  support_cases: 10,
  finance_io: 10,
  finance_insertion_orders: 10,
  finance_pos: 20,
  catalog_products: 10,
  catalog_services: 20,
  reports: 90,
};

function subscribeToSidebarCollapse(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (!event.key || event.key === SIDEBAR_COLLAPSE_KEY) {
      onStoreChange();
    }
  };
  const handleCustomEvent = () => onStoreChange();

  window.addEventListener("storage", handleStorage);
  window.addEventListener(SIDEBAR_COLLAPSE_EVENT, handleCustomEvent);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(SIDEBAR_COLLAPSE_EVENT, handleCustomEvent);
  };
}

function getSidebarCollapsedSnapshot() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "true";
}

function moduleLabel(module: AccessibleModule) {
  return module.display_name?.trim() || getModuleDisplayName(module.name, module.description ?? undefined);
}

function getCanonicalHref(module: AccessibleModule) {
  if (module.name === "sales_leads") return DASHBOARD_ROUTES.leads;
  if (module.name === "sales_organizations") return DASHBOARD_ROUTES.accounts;
  if (module.name === "sales_contacts") return DASHBOARD_ROUTES.contacts;
  if (module.name === "sales_opportunities") return DASHBOARD_ROUTES.deals;
  if (module.name === "sales_quotes") return DASHBOARD_ROUTES.quotes;
  if (module.name === "sales_orders") return DASHBOARD_ROUTES.orders;
  if (module.name === "contracts") return DASHBOARD_ROUTES.contracts;
  if (module.name === "support_cases") return DASHBOARD_ROUTES.supportCases;
  if (module.name === "reports") return DASHBOARD_ROUTES.reports;
  if (module.name === "tasks") return "/dashboard/tasks";
  return module.base_route || "";
}

function sidebarItemSortValue(item: { label: string; moduleName?: string }) {
  if (item.moduleName && item.moduleName in MODULE_ITEM_ORDER) {
    return MODULE_ITEM_ORDER[item.moduleName];
  }
  return 1_000;
}

function buildOperationalGroups(modules: AccessibleModule[]) {
  const groupMap = new Map<string, SidebarGroupConfig>();

  function ensureGroup(module: AccessibleModule) {
    const key = module.sidebar_tab_key || "other";
    const system = SYSTEM_GROUPS[key];
    const current = groupMap.get(key);
    if (current) return current;
    const group: SidebarGroupConfig = {
      key,
      label: module.sidebar_tab_label || system?.label || key.replaceAll("_", " "),
      icon: system?.icon || Wrench,
      sortOrder: system?.sortOrder ?? 75,
      items: [],
    };
    groupMap.set(key, group);
    return group;
  }

  for (const crmModule of modules) {
    if (!crmModule.base_route) continue;
    if (crmModule.sidebar_tab_key === HIDDEN_SIDEBAR_TAB_KEY) continue;
    if (crmModule.base_route === DASHBOARD_ROUTES.home || crmModule.base_route.startsWith(SETTINGS_ROUTES.root)) continue;

    const href = getCanonicalHref(crmModule);
    if (!href) continue;
    const group = ensureGroup(crmModule);
    group.items.push({ href, label: moduleLabel(crmModule), moduleName: crmModule.name });
  }

  return Array.from(groupMap.values())
    .map((group) => ({
      ...group,
      items: group.items
        .filter((item, index, items) => items.findIndex((candidate) => candidate.href === item.href) === index)
        .sort((a, b) => sidebarItemSortValue(a) - sidebarItemSortValue(b) || a.label.localeCompare(b.label)),
    }))
    .filter((group) => group.items.length > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
}

function settingsGroup(): SidebarGroupConfig {
  return {
    ...SYSTEM_GROUPS.settings,
    items: [
      { href: SETTINGS_ROUTES.general, label: "General" },
      { href: SETTINGS_ROUTES.users, label: "User Management" },
      { href: SETTINGS_ROUTES.teams, label: "Teams" },
      { href: SETTINGS_ROUTES.customerGroups, label: "Customer Groups" },
      { href: SETTINGS_ROUTES.permissions, label: "Permissions" },
      { href: SETTINGS_ROUTES.modules, label: "Module Settings" },
      { href: SETTINGS_ROUTES.moduleBuilder, label: "Module Builder" },
      { href: SETTINGS_ROUTES.fields, label: "Field Config" },
      { href: SETTINGS_ROUTES.automation, label: "Automation" },
      { href: SETTINGS_ROUTES.calendarBooking, label: "Booking Links" },
      { href: SETTINGS_ROUTES.integrations, label: "Integrations" },
      { href: SETTINGS_ROUTES.templates, label: "Templates" },
      { href: SETTINGS_ROUTES.activityLog, label: "Activity Log" },
      { href: SETTINGS_ROUTES.recycleBin, label: "Recycle Bin" },
    ],
  };
}

function activeGroupKey(pathname: string, groups: SidebarGroupConfig[]) {
  const active = groups.find((group) =>
    group.items.some((item) => pathname === item.href || pathname.startsWith(item.href + "/")),
  );
  return active?.key ?? groups[0]?.key ?? "";
}

export default function Sidebar() {
  const pathname = usePathname();
  const { user, isAdmin, logout } = useSidebarUser();
  const { modules } = useAccessibleModules();
  const collapsed = useSyncExternalStore(
    subscribeToSidebarCollapse,
    getSidebarCollapsedSnapshot,
    () => false,
  );

  const groups = useMemo(() => {
    const next = buildOperationalGroups(modules);
    if (isAdmin) next.push(settingsGroup());
    return next;
  }, [isAdmin, modules]);
  const activeGroup = useMemo(() => activeGroupKey(pathname, groups), [groups, pathname]);
  const [manualOpenGroup, setManualOpenGroup] = useState<{ pathname: string; key: string } | null>(null);
  const openGroup = manualOpenGroup?.pathname === pathname ? manualOpenGroup.key : activeGroup;

  function toggleCollapsed() {
    const next = !collapsed;
    window.localStorage.setItem(SIDEBAR_COLLAPSE_KEY, String(next));
    window.dispatchEvent(new Event(SIDEBAR_COLLAPSE_EVENT));
  }

  const displayName =
    `${user?.first_name ?? ""} ${user?.last_name ?? ""}`.trim() ||
    user?.email?.split("@")[0] ||
    "User";

  const initials =
    ((user?.first_name?.[0] ?? "") + (user?.last_name?.[0] ?? "")) || "US";

  return (
    <aside
      className={
        "relative z-10 flex h-screen flex-col transition-[width] duration-200 " +
        (collapsed ? "w-[4.5rem]" : "w-56")
      }
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden px-2 py-3">
        <div className={`mb-4 flex items-center gap-2 px-1 ${collapsed ? "flex-col justify-center" : "justify-between"}`}>
          <Link href={DASHBOARD_ROUTES.home} className="flex min-w-0 items-center gap-2 rounded-md focus:outline-none focus:ring-2 focus:ring-white/20">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5">
              <span className="font-lynk text-xl leading-none text-white">L</span>
            </div>
            {!collapsed ? <h1 className="font-lynk text-2xl tracking-tight text-white">Lynk</h1> : null}
          </Link>
          <button
            type="button"
            onClick={toggleCollapsed}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-white/6 hover:text-neutral-100"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>

        <SidebarNav>
          <SidebarGroup>
            <SidebarMenu>
              {groups.map((group) => (
                <SidebarMenuItemCollapsible
                  key={group.key}
                  label={group.label}
                  icon={group.icon}
                  collapsed={collapsed}
                  open={!collapsed && openGroup === group.key}
                  onOpenChange={(nextOpen) => setManualOpenGroup({ pathname, key: nextOpen ? group.key : "" })}
                >
                  {group.items.map((item) => (
                    <SidebarMenuItemChild key={item.href} href={item.href} collapsed={collapsed}>
                      {item.label}
                    </SidebarMenuItemChild>
                  ))}
                </SidebarMenuItemCollapsible>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarNav>

        <div className="shrink-0 pt-4">
          <div className="relative overflow-hidden rounded-lg border border-white/10 bg-white/5">
            <div className="noise-overlay pointer-events-none absolute inset-0 rounded-lg opacity-20" />

            <div className="relative z-10 flex flex-col">
              <div className={`flex items-center border-b border-white/8 px-2 py-1.5 ${collapsed ? "justify-center" : "justify-between"}`}>
                {!collapsed ? (
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                    Notifications
                  </span>
                ) : null}
                <NotificationCenter />
              </div>

              <div className={`flex items-center p-1.5 ${collapsed ? "justify-center" : "gap-1"}`}>
                <Link
                  href="/dashboard/profile"
                  className={`flex min-w-0 items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-white/6 ${
                    collapsed ? "justify-center" : "flex-1"
                  }`}
                  title={collapsed ? displayName : undefined}
                >
                  {user?.photo_url ? (
                    <Image
                      src={resolveMediaUrl(user.photo_url)}
                      alt="profile"
                      width={30}
                      height={30}
                      unoptimized
                      className="h-8 w-8 shrink-0 rounded-md object-cover shadow-sm"
                    />
                  ) : (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-[10px] font-bold text-black shadow-sm">
                      {initials}
                    </div>
                  )}

                  {!collapsed ? (
                    <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs font-semibold text-neutral-100">
                      {displayName}
                    </span>
                  ) : null}
                </Link>

                {!collapsed ? (
                  <button
                    onClick={logout}
                    type="button"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-white/6 hover:text-red-300"
                    title="Logout"
                  >
                    <LogOut size={14} />
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
