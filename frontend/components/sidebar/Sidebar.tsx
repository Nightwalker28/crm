"use client";

import { useMemo, useState, useSyncExternalStore, type ComponentType } from "react";
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
  CalendarDays,
  BarChart3,
} from "lucide-react";
import { usePathname } from "next/navigation";

import { useAccessibleModules, type AccessibleModule } from "@/hooks/useAccessibleModules";
import { useSidebarUser } from "@/hooks/useSidebarUser";
import { getModuleDisplayName } from "@/lib/module-display";
import { getDependentModuleDefinitions, getModuleDefinition, getModuleRoute, isModuleVisibleInNavigation } from "@/lib/module-registry";
import { DASHBOARD_ROUTES, SETTINGS_ROUTES } from "@/lib/routes";

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItemChild,
  SidebarMenuItemCollapsible,
  SidebarMenuItemLink,
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
  workspace: { key: "workspace", label: "Workspace", icon: CalendarDays, sortOrder: 5 },
  sales: { key: "sales", label: "Sales", icon: BriefcaseBusiness, sortOrder: 10 },
  finance: { key: "finance", label: "Finance", icon: Landmark, sortOrder: 20 },
  catalog: { key: "catalog", label: "Products & Services", icon: Boxes, sortOrder: 30 },
  support: { key: "support", label: "Support", icon: LifeBuoy, sortOrder: 40 },
  reports: { key: "reports", label: "Reports", icon: BarChart3, sortOrder: 80 },
  settings: { key: "settings", label: "Settings", icon: Settings2, sortOrder: 90 },
  other: { key: "other", label: "Other", icon: Wrench, sortOrder: 100 },
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
  return getModuleRoute(module.name, module.base_route);
}

function sidebarItemSortValue(item: { label: string; moduleName?: string }) {
  if (item.moduleName) {
    return getModuleDefinition(item.moduleName)?.sortOrder ?? 1_000;
  }
  return 1_000;
}

function buildOperationalGroups(modules: AccessibleModule[]) {
  const groupMap = new Map<string, SidebarGroupConfig>();

  function ensureGroup(module: AccessibleModule) {
    const key = module.sidebar_tab_key || getModuleDefinition(module.name)?.group || "other";
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
    if (!crmModule.name.startsWith("custom_") && !isModuleVisibleInNavigation(crmModule.name)) continue;

    const href = getCanonicalHref(crmModule);
    if (!href) continue;
    const group = ensureGroup(crmModule);
    group.items.push({ href, label: moduleLabel(crmModule), moduleName: crmModule.name });
    for (const dependent of getDependentModuleDefinitions(crmModule.name)) {
      group.items.push({ href: dependent.route, label: dependent.label, moduleName: dependent.key });
    }
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

function activeGroupKey(pathname: string, groups: SidebarGroupConfig[]) {
  const active = groups.find((group) =>
    group.items.some((item) => pathname === item.href || pathname.startsWith(item.href + "/")),
  );
  return active?.key ?? groups[0]?.key ?? "";
}

export default function Sidebar({ mobile = false, onNavigate }: { mobile?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { isAdmin, logout } = useSidebarUser();
  const { modules } = useAccessibleModules();
  const storedCollapsed = useSyncExternalStore(
    subscribeToSidebarCollapse,
    getSidebarCollapsedSnapshot,
    () => false,
  );
  const collapsed = mobile ? false : storedCollapsed;

  const groups = useMemo(() => {
    return buildOperationalGroups(modules);
  }, [modules]);
  const activeGroup = useMemo(() => activeGroupKey(pathname, groups), [groups, pathname]);
  const [manualOpenGroup, setManualOpenGroup] = useState<{ pathname: string; key: string } | null>(null);
  const openGroup = manualOpenGroup?.pathname === pathname ? manualOpenGroup.key : activeGroup;

  function toggleCollapsed() {
    const next = !collapsed;
    window.localStorage.setItem(SIDEBAR_COLLAPSE_KEY, String(next));
    window.dispatchEvent(new Event(SIDEBAR_COLLAPSE_EVENT));
  }

  return (
    <aside
      aria-label={mobile ? "Mobile navigation" : "Primary navigation"}
      className={
        "relative z-10 h-full shrink-0 flex-col bg-transparent transition-[width] duration-200 motion-reduce:transition-none " +
        (mobile ? "flex w-72" : `hidden border-r md:flex ${collapsed ? "w-[4.5rem] border-line-subtle" : "w-60 border-line-default"}`)
      }
    >
      <div className="relative z-10 flex h-full min-h-0 flex-col overflow-hidden px-2 py-3">
        <div className={`mb-4 flex items-center gap-2 px-1 ${collapsed ? "flex-col justify-center" : "justify-between"}`}>
          <Link href={DASHBOARD_ROUTES.home} onClick={onNavigate} className="flex min-w-0 items-center gap-2 rounded-[var(--radius-control)] focus:outline-none focus:ring-2 focus:ring-focus">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-line-default bg-surface-muted">
              <span className="font-lynk text-xl leading-none text-copy-primary">L</span>
            </div>
            {/* The wordmark is a brand mark inside a nav link, not the page's heading — it was an
                h1, which gave every dashboard page a second one. See design.md §8. */}
            {!collapsed ? <span className="font-lynk text-2xl tracking-tight text-copy-primary">Lynk</span> : null}
          </Link>
          {!mobile ? <button
            type="button"
            onClick={toggleCollapsed}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control-sm)] text-copy-muted transition-colors hover:bg-action-primary-muted hover:text-copy-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button> : null}
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
                    <SidebarMenuItemChild key={item.href} href={item.href} collapsed={collapsed} onNavigate={onNavigate}>
                      {item.label}
                    </SidebarMenuItemChild>
                  ))}
                </SidebarMenuItemCollapsible>
              ))}
              {isAdmin ? (
                <SidebarMenuItemLink
                  href={SETTINGS_ROUTES.root}
                  label="Settings"
                  icon={Settings2}
                  collapsed={collapsed}
                  onNavigate={onNavigate}
                />
              ) : null}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarNav>

        <div className="shrink-0 pt-4">
          <button
            onClick={logout}
            type="button"
            className={`flex w-full items-center gap-2 rounded-[var(--radius-control)] border border-transparent px-2 py-1.5 text-sm font-medium text-copy-secondary transition-colors hover:border-state-danger/30 hover:bg-state-danger-muted hover:text-state-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-danger ${collapsed ? "justify-center" : ""}`}
            aria-label="Log out"
            title={collapsed ? "Log out" : undefined}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {collapsed ? null : <span>Log out</span>}
          </button>
        </div>
      </div>
    </aside>
  );
}
