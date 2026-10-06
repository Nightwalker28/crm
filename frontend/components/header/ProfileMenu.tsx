"use client";

import Link from "next/link";
import { LogOut, Moon, Sun, UserRound } from "lucide-react";
import { useTheme } from "next-themes";

import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useSidebarUser } from "@/hooks/useSidebarUser";

/**
 * A menu, not a popover of hand-styled links: `DropdownMenu` gives it `role="menu"`, arrow keys
 * and typeahead, which the three rows here had none of. *Log out* is not destructive — nothing
 * is lost — so it no longer paints red on hover (§7.3).
 */
export function ProfileMenu() {
  const { user, logout } = useSidebarUser();
  const { resolvedTheme, setTheme } = useTheme();
  const nextTheme = resolvedTheme === "light" ? "dark" : "light";
  const fullName = `${user?.first_name ?? ""} ${user?.last_name ?? ""}`.trim();
  const displayName = fullName || user?.email?.split("@")[0] || "User";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Open profile menu" className="overflow-hidden">
          <Avatar name={fullName} email={user?.email} src={user?.photo_url} size="sm" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <div className="border-b border-line-subtle px-3 pb-2 pt-1.5">
          <p className="truncate text-sm font-medium text-copy-primary">{displayName}</p>
          {user?.email ? <p className="mt-0.5 truncate text-xs text-copy-muted">{user.email}</p> : null}
        </div>
        <div className="pt-1">
          <DropdownMenuItem asChild>
            <Link href="/dashboard/profile">
              <UserRound />
              Profile
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setTheme(nextTheme)}>
            {nextTheme === "light" ? <Sun /> : <Moon />}
            {nextTheme === "light" ? "Light theme" : "Dark theme"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void logout()}>
            <LogOut />
            Log out
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
