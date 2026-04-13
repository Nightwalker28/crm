"use client";

import Image from "next/image";
import Link from "next/link";
import { UserRound, HandCoins, LogOut, BriefcaseBusiness } from "lucide-react";
import { useSidebarUser } from "@/hooks/useSidebarUser";

import {
  SidebarNav,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuItemCollapsible,
  SidebarMenuItemChild,
} from "./SidebarNav";

export default function Sidebar() {
  const { user, logout } = useSidebarUser();

  const displayName =
    `${user?.first_name ?? ""} ${user?.last_name ?? ""}`.trim() ||
    user?.email?.split("@")[0] ||
    "User";

  const initials =
    ((user?.first_name?.[0] ?? "") + (user?.last_name?.[0] ?? "")) || "US";

  return (
    <aside className="relative z-10 flex h-screen w-52 flex-col py-6 pl-4">
      <div className="mb-6 flex justify-center">
        <h1 className="text-5xl font-lynk text-white tracking-tight">Lynk</h1>
      </div>

      <SidebarNav>
        <SidebarGroup>
          <SidebarGroupLabel>Main</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItemCollapsible icon={UserRound} label="Admin">
              <SidebarMenuItemChild href="/dashboard/users">
                Users
              </SidebarMenuItemChild>
              <SidebarMenuItemChild href="/dashboard/user/teams">
                Teams & Departments
              </SidebarMenuItemChild>
              <SidebarMenuItemChild href="/dashboard/company">
                Company
              </SidebarMenuItemChild>
            </SidebarMenuItemCollapsible>
            <SidebarMenuItemCollapsible icon={HandCoins} label="Finance">
              <SidebarMenuItemChild href="/dashboard/finance/insertion-orders">
                Insertion Orders
              </SidebarMenuItemChild>
            </SidebarMenuItemCollapsible>

            <SidebarMenuItemCollapsible icon={BriefcaseBusiness} label="Sales">
              <SidebarMenuItemChild href="/dashboard/sales/organizations">
                Organizations
              </SidebarMenuItemChild>
              <SidebarMenuItemChild href="/dashboard/sales/contacts">
                Contacts
              </SidebarMenuItemChild>
              </SidebarMenuItemCollapsible>

          </SidebarMenu>
        </SidebarGroup>
      </SidebarNav>

      <div className="mt-auto pt-6">
        <div className="relative">
          <div
            className="absolute inset-0 pointer-events-none mix-blend-multiply bg-repeat 
            bg-size-[150px_150px] bg-[url('https://grainy-gradients.vercel.app/noise.svg')] 
            opacity-15 rounded-md"
          />

          <div
            className="relative z-10 flex items-center justify-between gap-2 rounded-md px-2 pr-3 py-2
            border border-white/15 bg-white/8 backdrop-blur-md 
            text-neutral-100 transition-colors duration-150 
            hover:bg-white/12 hover:border-white/25"
          >
            <Link href="/dashboard/profile" className="flex items-center gap-1.5 min-w-0">
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
                className="text-xs font-semibold text-neutral-100 whitespace-nowrap 
                overflow-hidden text-ellipsis max-w-[90px]"
              >
                {displayName}
              </span>
            </Link>

            <button
              onClick={logout}
              className="text-neutral-300 hover:text-red-300 transition-colors"
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
