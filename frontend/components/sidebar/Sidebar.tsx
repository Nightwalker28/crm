"use client";

import { useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  CalendarDays,
  FileText,
  MessageCircle,
  Mail,
  LayoutGrid,
  HandCoins,
  ClipboardList,
  LogOut,
  BriefcaseBusiness,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  Wrench,
} from "lucide-react";
import { useSidebarUser } from "@/hooks/useSidebarUser";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import NotificationCenter from "@/components/notifications/NotificationCenter";
import { resolveMediaUrl } from "@/lib/media";
import { getModuleDisplayName } from "@/lib/module-display";
import { DASHBOARD_ROUTES, SETTINGS_ROUTES } from "@/lib/routes";

import {
  SidebarNav,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuItemCollapsible,
  SidebarMenuItemChild,
} from "./SidebarNav";

const SIDEBAR_COLLAPSE_KEY = "lynk:sidebar-collapsed";
const SIDEBAR_COLLAPSE_EVENT = "lynk:sidebar-collapsed-change";

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

function SidebarSectionLabel({ children, collapsed }: { children: string; collapsed: boolean }) {
  return (
    <div
      className={
        "mt-3 border-t border-white/6 px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-600 transition-all duration-200 first:mt-0 first:border-t-0 first:pt-0 " +
        (collapsed ? "opacity-0 group-hover/sidebar:opacity-100" : "opacity-100")
      }
    >
      {children}
    </div>
  );
}

export default function Sidebar() {
  const { user, isAdmin, logout } = useSidebarUser();
  const { modules } = useAccessibleModules();
  const collapsed = useSyncExternalStore(
    subscribeToSidebarCollapse,
    getSidebarCollapsedSnapshot,
    () => false,
  );

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

  const moduleMap = new Map(modules.map((module) => [module.name, module]));
  const documentsModule = moduleMap.get("documents");
  const financeIoModule = moduleMap.get("finance_io");
  const financePosModule = moduleMap.get("finance_pos");
  const tasksModule = moduleMap.get("tasks");
  const calendarModule = moduleMap.get("calendar");
  const mailModule = moduleMap.get("mail");
  const whatsappModule = moduleMap.get("whatsapp");
  const contactsModule = moduleMap.get("sales_contacts");
  const organizationsModule = moduleMap.get("sales_organizations");
  const opportunitiesModule = moduleMap.get("sales_opportunities");
  const catalogProductsModule = moduleMap.get("catalog_products");
  const catalogServicesModule = moduleMap.get("catalog_services");
  const customModules = modules
    .filter((module) => module.base_route?.startsWith("/dashboard/custom/"))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <aside
      className={
        "group/sidebar relative z-10 flex h-screen flex-col transition-[width] duration-200 " +
        (collapsed ? "w-14 hover:w-52" : "w-52")
      }
    >
      {/* Inner padding wrapper */}
      <div className="flex h-full min-h-0 flex-col px-2 py-3">

        {/* Logo + toggle */}
        <div className="mb-4 flex items-center justify-between gap-1 px-1">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5">
              <span className="font-lynk text-xl leading-none text-white">L</span>
            </div>
            <h1
              className={
                "font-lynk text-2xl tracking-tight text-white transition-all duration-200 " +
                (collapsed
                  ? "w-0 overflow-hidden opacity-0 group-hover/sidebar:w-auto group-hover/sidebar:opacity-100"
                  : "opacity-100")
              }
            >
              Lynk
            </h1>
          </div>
          <button
            type="button"
            onClick={toggleCollapsed}
            className={
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-white/6 hover:text-neutral-100 " +
              (collapsed ? "opacity-0 group-hover/sidebar:opacity-100" : "opacity-100")
            }
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-3.5 w-3.5" />
            ) : (
              <PanelLeftClose className="h-3.5 w-3.5" />
            )}
          </button>
        </div>

        {/* Nav */}
        <SidebarNav>
          <SidebarGroup>
            <SidebarMenu>
              <SidebarMenuItem href="/dashboard" icon={LayoutGrid} collapsed={collapsed}>
                Dashboard
              </SidebarMenuItem>

              <SidebarSectionLabel collapsed={collapsed}>Workspace</SidebarSectionLabel>

              {tasksModule?.base_route ? (
                <SidebarMenuItem href={tasksModule.base_route} icon={ClipboardList} collapsed={collapsed}>
                  Tasks
                </SidebarMenuItem>
              ) : null}

              {calendarModule?.base_route ? (
                <SidebarMenuItem href={calendarModule.base_route} icon={CalendarDays} collapsed={collapsed}>
                  Calendar
                </SidebarMenuItem>
              ) : null}

              {mailModule?.base_route ? (
                <SidebarMenuItem href={mailModule.base_route} icon={Mail} collapsed={collapsed}>
                  Mail
                </SidebarMenuItem>
              ) : null}

              {documentsModule?.base_route ? (
                <SidebarMenuItem href={documentsModule.base_route} icon={FileText} collapsed={collapsed}>
                  Documents
                </SidebarMenuItem>
              ) : null}

              {whatsappModule?.base_route ? (
                <SidebarMenuItem href={whatsappModule.base_route} icon={MessageCircle} collapsed={collapsed}>
                  WhatsApp
                </SidebarMenuItem>
              ) : null}

              <SidebarSectionLabel collapsed={collapsed}>Sales CRM</SidebarSectionLabel>

              {(organizationsModule?.base_route || contactsModule?.base_route || opportunitiesModule?.base_route) ? (
                <SidebarMenuItemCollapsible icon={BriefcaseBusiness} label="Sales CRM" collapsed={collapsed}>
                  <SidebarMenuItemChild href={DASHBOARD_ROUTES.sales} collapsed={collapsed}>
                    Overview
                  </SidebarMenuItemChild>
                  {organizationsModule?.base_route ? (
                    <SidebarMenuItemChild href={DASHBOARD_ROUTES.accounts} collapsed={collapsed}>
                      Accounts
                    </SidebarMenuItemChild>
                  ) : null}
                  {contactsModule?.base_route ? (
                    <SidebarMenuItemChild href={DASHBOARD_ROUTES.contacts} collapsed={collapsed}>
                      Contacts
                    </SidebarMenuItemChild>
                  ) : null}
                  {opportunitiesModule?.base_route ? (
                    <SidebarMenuItemChild href={DASHBOARD_ROUTES.deals} collapsed={collapsed}>
                      Deals
                    </SidebarMenuItemChild>
                  ) : null}
                  {(contactsModule?.base_route || organizationsModule?.base_route) ? (
                    <SidebarMenuItemChild href={DASHBOARD_ROUTES.clientPortal} collapsed={collapsed}>
                      Client Portal
                    </SidebarMenuItemChild>
                  ) : null}
                </SidebarMenuItemCollapsible>
              ) : null}

              <SidebarSectionLabel collapsed={collapsed}>Products & Services</SidebarSectionLabel>

              {(catalogProductsModule?.base_route || catalogServicesModule?.base_route) ? (
                <SidebarMenuItemCollapsible icon={Package} label="Products & Services" collapsed={collapsed}>
                  {catalogProductsModule?.base_route ? (
                    <SidebarMenuItemChild href={DASHBOARD_ROUTES.products} collapsed={collapsed}>
                      Products
                    </SidebarMenuItemChild>
                  ) : null}
                  {catalogServicesModule?.base_route ? (
                    <SidebarMenuItemChild href={DASHBOARD_ROUTES.services} collapsed={collapsed}>
                      Services
                    </SidebarMenuItemChild>
                  ) : null}
                </SidebarMenuItemCollapsible>
              ) : null}

              <SidebarSectionLabel collapsed={collapsed}>Finance</SidebarSectionLabel>

              {(financeIoModule?.base_route || financePosModule?.base_route) ? (
                <SidebarMenuItemCollapsible icon={HandCoins} label="Finance" collapsed={collapsed}>
                  <SidebarMenuItemChild href={DASHBOARD_ROUTES.finance} collapsed={collapsed}>
                    Overview
                  </SidebarMenuItemChild>
                  {financePosModule?.base_route ? (
                    <SidebarMenuItemChild href={DASHBOARD_ROUTES.financePos} collapsed={collapsed}>
                      POS
                    </SidebarMenuItemChild>
                  ) : null}
                  {financeIoModule?.base_route ? (
                    <SidebarMenuItemChild href={DASHBOARD_ROUTES.insertionOrders} collapsed={collapsed}>
                      Insertion Orders
                    </SidebarMenuItemChild>
                  ) : null}
                </SidebarMenuItemCollapsible>
              ) : null}

              {customModules.length > 0 ? (
                <>
                  <SidebarSectionLabel collapsed={collapsed}>Custom Modules</SidebarSectionLabel>
                  <SidebarMenuItemCollapsible icon={Wrench} label="Custom Modules" collapsed={collapsed}>
                  {customModules.map((module) => (
                    <SidebarMenuItemChild key={module.id} href={module.base_route as string} collapsed={collapsed}>
                      {getModuleDisplayName(module.name, module.description ?? undefined)}
                    </SidebarMenuItemChild>
                  ))}
                  </SidebarMenuItemCollapsible>
                </>
              ) : null}

              {isAdmin ? (
                <>
                  <SidebarSectionLabel collapsed={collapsed}>Settings</SidebarSectionLabel>
                  <SidebarMenuItemCollapsible icon={Settings2} label="Settings" collapsed={collapsed}>
                    <SidebarMenuItemChild href={SETTINGS_ROUTES.root} collapsed={collapsed}>
                      Settings Overview
                    </SidebarMenuItemChild>
                    <SidebarMenuItemChild href={SETTINGS_ROUTES.general} collapsed={collapsed}>
                      General
                    </SidebarMenuItemChild>
                    <SidebarMenuItemChild href={SETTINGS_ROUTES.users} collapsed={collapsed}>
                      User Management
                    </SidebarMenuItemChild>
                    <SidebarMenuItemChild href={SETTINGS_ROUTES.teams} collapsed={collapsed}>
                      Teams
                    </SidebarMenuItemChild>
                    <SidebarMenuItemChild href={SETTINGS_ROUTES.permissions} collapsed={collapsed}>
                      Permissions
                    </SidebarMenuItemChild>
                    <SidebarMenuItemChild href={SETTINGS_ROUTES.modules} collapsed={collapsed}>
                      Module Settings
                    </SidebarMenuItemChild>
                    <SidebarMenuItemChild href={SETTINGS_ROUTES.moduleBuilder} collapsed={collapsed}>
                      Module Builder
                    </SidebarMenuItemChild>
                    <SidebarMenuItemChild href={SETTINGS_ROUTES.fields} collapsed={collapsed}>
                      Field Config
                    </SidebarMenuItemChild>
                    <SidebarMenuItemChild href={SETTINGS_ROUTES.integrations} collapsed={collapsed}>
                      Integrations
                    </SidebarMenuItemChild>
                    <SidebarMenuItemChild href={SETTINGS_ROUTES.templates} collapsed={collapsed}>
                      Templates
                    </SidebarMenuItemChild>
                  </SidebarMenuItemCollapsible>
                </>
              ) : null}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarNav>

        {/* Bottom user card */}
        <div className="shrink-0 pt-4">
          <div className="relative overflow-hidden rounded-lg border border-white/10 bg-white/5">
            {/* Noise texture */}
            <div className="noise-overlay absolute inset-0 pointer-events-none rounded-lg opacity-20" />

            <div className="relative z-10 flex flex-col">
              {/* Notification row — always icon-only in collapsed, full in expanded */}
              <div
                className={
                  "flex items-center border-b border-white/8 px-2 py-1.5 " +
                  (collapsed
                    ? "justify-center group-hover/sidebar:justify-between"
                    : "justify-between")
                }
              >
                {/* Label — hidden when collapsed */}
                <span
                  className={
                    "text-[10px] font-semibold uppercase tracking-wider text-neutral-500 transition-all duration-200 " +
                    (collapsed
                      ? "w-0 overflow-hidden opacity-0 group-hover/sidebar:w-auto group-hover/sidebar:opacity-100"
                      : "opacity-100")
                  }
                >
                  Notifications
                </span>
                <NotificationCenter />
              </div>

              {/* User identity row */}
              <div className="flex items-center gap-0 p-1.5">
                <Link
                  href="/dashboard/profile"
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-white/6"
                >
                {user?.photo_url ? (
                  <Image
                    src={resolveMediaUrl(user.photo_url)}
                    alt="profile"
                    width={28}
                    height={28}
                    unoptimized
                    className="h-7 w-7 shrink-0 rounded-md object-cover shadow-sm"
                  />
                  ) : (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-[9px] font-bold text-black shadow-sm">
                      {initials}
                    </div>
                  )}

                  <span
                    className={
                      "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs font-semibold text-neutral-100 transition-all duration-200 " +
                      (collapsed
                        ? "w-0 opacity-0 group-hover/sidebar:w-auto group-hover/sidebar:opacity-100"
                        : "opacity-100")
                    }
                  >
                    {displayName}
                  </span>
                </Link>

                <button
                  onClick={logout}
                  type="button"
                  className={
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-white/6 hover:text-red-300 " +
                    (collapsed
                      ? "opacity-0 group-hover/sidebar:opacity-100"
                      : "opacity-100")
                  }
                  title="Logout"
                >
                  <LogOut size={13} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
