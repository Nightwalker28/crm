"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { UserRound, HandCoins, LogOut, BriefcaseBusiness, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useSidebarUser } from "@/hooks/useSidebarUser";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";

import {
  SidebarNav,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItemCollapsible,
  SidebarMenuItemChild,
} from "./SidebarNav";

export default function Sidebar() {
  const { user, logout } = useSidebarUser();
  const { modules } = useAccessibleModules();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem("lynk:sidebar-collapsed");
    setCollapsed(stored === "true");
  }, []);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("lynk:sidebar-collapsed", String(next));
      return next;
    });
  }

  const displayName =
    `${user?.first_name ?? ""} ${user?.last_name ?? ""}`.trim() ||
    user?.email?.split("@")[0] ||
    "User";

  const initials =
    ((user?.first_name?.[0] ?? "") + (user?.last_name?.[0] ?? "")) || "US";
  const moduleMap = new Map(modules.map((module) => [module.name, module]));
  const financeIoModule = moduleMap.get("finance_io");
  const contactsModule = moduleMap.get("sales_contacts");
  const organizationsModule = moduleMap.get("sales_organizations");
  const opportunitiesModule = moduleMap.get("sales_opportunities");

  return (
    <aside
      className={
        "group/sidebar relative z-10 flex h-screen flex-col px-3 py-4 transition-[width] duration-200 " +
        (collapsed ? "w-16 hover:w-52" : "w-52")
      }
    >
      <div className="mb-5 flex items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5">
            <span className="font-lynk text-2xl leading-none text-white">L</span>
          </div>
          <h1
            className={
              "font-lynk text-3xl tracking-tight text-white transition-all duration-200 " +
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
          className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-white/6 hover:text-neutral-100"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      <SidebarNav>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItemCollapsible icon={UserRound} label="Admin" collapsed={collapsed}>
              <SidebarMenuItemChild href="/dashboard/users" collapsed={collapsed}>
                Users
              </SidebarMenuItemChild>
              <SidebarMenuItemChild href="/dashboard/user/teams" collapsed={collapsed}>
                Teams & Departments
              </SidebarMenuItemChild>
              <SidebarMenuItemChild href="/dashboard/company" collapsed={collapsed}>
                Company
              </SidebarMenuItemChild>
              <SidebarMenuItemChild href="/dashboard/roles-permissions" collapsed={collapsed}>
                Roles & Permissions
              </SidebarMenuItemChild>
              <SidebarMenuItemChild href="/dashboard/custom-fields" collapsed={collapsed}>
                Custom Fields
              </SidebarMenuItemChild>
              <SidebarMenuItemChild href="/dashboard/modules" collapsed={collapsed}>
                Modules
              </SidebarMenuItemChild>
              <SidebarMenuItemChild href="/dashboard/recycle-bin" collapsed={collapsed}>
                Recycle Bin
              </SidebarMenuItemChild>
              <SidebarMenuItemChild href="/dashboard/activity-log" collapsed={collapsed}>
                Activity Log
              </SidebarMenuItemChild>
            </SidebarMenuItemCollapsible>
            {financeIoModule?.base_route ? (
              <SidebarMenuItemCollapsible icon={HandCoins} label="Finance" collapsed={collapsed}>
                <SidebarMenuItemChild href={financeIoModule.base_route} collapsed={collapsed}>
                  Insertion Orders
                </SidebarMenuItemChild>
              </SidebarMenuItemCollapsible>
            ) : null}

            {(organizationsModule?.base_route || contactsModule?.base_route || opportunitiesModule?.base_route) ? (
              <SidebarMenuItemCollapsible icon={BriefcaseBusiness} label="Sales" collapsed={collapsed}>
                {organizationsModule?.base_route ? (
                  <SidebarMenuItemChild href={organizationsModule.base_route} collapsed={collapsed}>
                    Organizations
                  </SidebarMenuItemChild>
                ) : null}
                {contactsModule?.base_route ? (
                  <SidebarMenuItemChild href={contactsModule.base_route} collapsed={collapsed}>
                    Contacts
                  </SidebarMenuItemChild>
                ) : null}
                {opportunitiesModule?.base_route ? (
                  <SidebarMenuItemChild href={opportunitiesModule.base_route} collapsed={collapsed}>
                    Opportunities
                  </SidebarMenuItemChild>
                ) : null}
              </SidebarMenuItemCollapsible>
            ) : null}

          </SidebarMenu>
        </SidebarGroup>
      </SidebarNav>

      <div className="mt-auto pt-6">
        <div
          className="relative noise-overlay rounded-lg border border-white/12 bg-white/6 p-1.5 text-neutral-100 transition-colors duration-150 hover:bg-white/10 hover:border-white/20"
        >
          <div className="flex items-center justify-between gap-2">
            <Link href="/dashboard/profile" className="flex min-w-0 items-center gap-2 rounded-md px-1 py-1">
              {user?.photo_url ? (
                <Image
                  src={user.photo_url}
                  alt="profile"
                  width={32}
                  height={32}
                  className="h-8 w-8 rounded-md object-cover shadow-sm"
                />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-neutral-100 text-[10px] font-bold text-black shadow-sm">
                  {initials}
                </div>
              )}

              <span
                className={
                  "max-w-[110px] overflow-hidden text-ellipsis whitespace-nowrap text-xs font-semibold text-neutral-100 transition-all duration-200 " +
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
              className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-300 transition-colors hover:bg-white/6 hover:text-red-300"
              title="Logout"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
