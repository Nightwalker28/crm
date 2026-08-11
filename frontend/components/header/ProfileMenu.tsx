"use client";

import Image from "next/image";
import Link from "next/link";
import { LogOut, Moon, Sun, UserRound } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSidebarUser } from "@/hooks/useSidebarUser";
import { resolveMediaUrl } from "@/lib/media";

export function ProfileMenu() {
  const { user, logout } = useSidebarUser();
  const { resolvedTheme, setTheme } = useTheme();
  const nextTheme = resolvedTheme === "light" ? "dark" : "light";
  const displayName = `${user?.first_name ?? ""} ${user?.last_name ?? ""}`.trim() || user?.email?.split("@")[0] || "User";
  const initials = ((user?.first_name?.[0] ?? "") + (user?.last_name?.[0] ?? "")).toUpperCase() || "US";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Open profile menu" className="overflow-hidden">
          {user?.photo_url ? (
            <Image
              src={resolveMediaUrl(user.photo_url)}
              alt=""
              width={32}
              height={32}
              unoptimized
              className="h-8 w-8 rounded-[var(--radius-control-sm)] object-cover"
            />
          ) : initials !== "US" ? (
            <span className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-control-sm)] bg-copy-primary text-[10px] font-bold text-app">{initials}</span>
          ) : (
            <UserRound />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 border-line-default bg-surface-raised p-2">
        <div className="border-b border-line-subtle px-2 pb-2 pt-1">
          <p className="truncate text-sm font-semibold text-copy-primary">{displayName}</p>
          {user?.email ? <p className="mt-0.5 truncate text-xs text-copy-muted">{user.email}</p> : null}
        </div>
        <div className="pt-1">
          <Link href="/dashboard/profile" className="flex items-center gap-2 rounded-[var(--radius-control-sm)] px-2 py-2 text-sm text-copy-secondary hover:bg-surface-muted hover:text-copy-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            <UserRound className="h-4 w-4" />Profile
          </Link>
          <button
            type="button"
            onClick={() => setTheme(nextTheme)}
            className="flex w-full items-center gap-2 rounded-[var(--radius-control-sm)] px-2 py-2 text-left text-sm text-copy-secondary hover:bg-surface-muted hover:text-copy-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {nextTheme === "light" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {nextTheme === "light" ? "Light theme" : "Dark theme"}
          </button>
          <button type="button" onClick={() => void logout()} className="flex w-full items-center gap-2 rounded-[var(--radius-control-sm)] px-2 py-2 text-left text-sm text-copy-secondary hover:bg-state-danger-muted hover:text-state-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-danger">
            <LogOut className="h-4 w-4" />Log out
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
