"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, LogOut } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { clearClientToken, useClientMe } from "@/hooks/useClientPortal";
import { CLIENT_PORTAL_ROUTES } from "@/lib/client-portal-nav";

/**
 * The portal's top bar identity (13d §3.7): who is signed in, for which business, and the two
 * things a customer does with their account here — change the password and sign out. The
 * dashboard's `ProfileMenu` shape, on the portal's own session.
 */
export function ClientAccountMenu() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useClientMe();
  const name = me.data?.contact_name || me.data?.organization_name || me.data?.email || "";

  function signOut() {
    clearClientToken();
    queryClient.removeQueries({ queryKey: ["client-auth"] });
    queryClient.removeQueries({ queryKey: ["client-overview"] });
    router.replace(`${CLIENT_PORTAL_ROUTES.login}?redirect=%2Fclient`);
  }

  if (!me.data) return null;
  return (
    <div className="ml-auto flex min-w-0 items-center gap-3">
      <div className="hidden min-w-0 text-right sm:block">
        <p className="truncate text-sm font-medium text-copy-primary">{name}</p>
        {me.data.company_name ? <p className="truncate text-xs text-copy-muted">{me.data.company_name}</p> : null}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Open account menu" className="overflow-hidden">
            <Avatar name={name} email={me.data.email} size="sm" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64">
          <div className="border-b border-line-subtle px-3 pb-2 pt-1.5">
            <p className="truncate text-sm font-medium text-copy-primary">{name}</p>
            <p className="mt-0.5 truncate text-xs text-copy-muted">{me.data.email}</p>
          </div>
          <div className="pt-1">
            <DropdownMenuItem asChild>
              <Link href={CLIENT_PORTAL_ROUTES.account}>
                <KeyRound />
                Change password
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={signOut}>
              <LogOut />
              Sign out
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
