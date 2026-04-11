"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { UserRound, HandCoins, LogOut, BriefcaseBusiness } from "lucide-react";
import { apiFetch } from "@/lib/api";

import {
  SidebarNav,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItemCollapsible,
  SidebarMenuItemChild,
} from "./SidebarNav";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL;

type UserProfile = {
  email?: string;
  first_name?: string;
  last_name?: string;
  photo_url?: string;
};

function safeReadCachedUser(): UserProfile | null {
  const cached = sessionStorage.getItem("lynk_user");
  if (!cached) return null;
  try {
    return JSON.parse(cached) as UserProfile;
  } catch {
    sessionStorage.removeItem("lynk_user");
    return null;
  }
}

function clearAuthStorage() {
  sessionStorage.removeItem("lynk_user");
  sessionStorage.removeItem("lynk_modules");
}

export default function Sidebar() {
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(null);

  useEffect(() => {
    const cachedUser = safeReadCachedUser();
    if (cachedUser) {
      setUser(cachedUser);
      return;
    }

    (async () => {
      try {
        const res = await apiFetch("/users/me");

        const me = (await res.json()) as UserProfile;
        sessionStorage.setItem("lynk_user", JSON.stringify(me));
        setUser(me);

      } catch {
        clearAuthStorage();
        router.replace("/auth/login");
      }
    })();
  }, [router]);

  const displayName =
    `${user?.first_name ?? ""} ${user?.last_name ?? ""}`.trim() ||
    user?.email?.split("@")[0] ||
    "User";

  const initials =
    ((user?.first_name?.[0] ?? "") + (user?.last_name?.[0] ?? "")) || "US";

  async function handleLogout() {
    await apiFetch("/auth/logout", {
      method: "POST",
    });

    sessionStorage.clear();
    router.push("/auth/login");
  }


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
            <div className="flex items-center gap-1.5">
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
            </div>

            <button
              onClick={handleLogout}
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
