"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { SidebarMenu, SidebarMenuItemLink, SidebarNav } from "@/components/sidebar/SidebarNav";
import { clearClientToken } from "@/hooks/useClientPortal";
import { CLIENT_PORTAL_ROUTES, CLIENT_PORTAL_SECTIONS } from "@/lib/client-portal-nav";

/**
 * The client portal's primary navigation — rebuild 5.8, ruling 1.
 *
 * The portal had no layout at all, so the hub was its only index and any two-section task
 * round-tripped through it: Orders → `/client` → Quotes. That is A8's defect exactly, and
 * the settings rail was the precedent for the fix. (Settings later dropped its rail for the
 * hub plus a header back arrow, 2026-10-01; the portal keeps its rail, since its sections are
 * a customer's everyday navigation rather than occasional configuration.)
 *
 * It is **built from the sidebar's own parts** rather than styled to match them. The active
 * treatment is `navItemClassName` itself (§7.16) because a second nav that marked its
 * position a different way would read as a different kind of thing, and a copy is how the
 * two would drift. The collapse is the sidebar's mechanism on the portal's own storage key:
 * a customer's portal and an operator's dashboard are different sessions and should not
 * share a preference.
 *
 * There is no "Home" entry, as there is none in the dashboard: the wordmark is the way back.
 * That is not only convention — `useIsActive` matches on `startsWith(href + "/")`, so a
 * `/client` entry would light up on every page in the portal.
 */
const COLLAPSE_KEY = "lynk:client-rail-collapsed";
const COLLAPSE_EVENT = "lynk:client-rail-collapsed-change";

function subscribeToCollapse(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(COLLAPSE_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(COLLAPSE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function getCollapsedSnapshot() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "true";
  } catch {
    // A portal opened in a private window with site data blocked still navigates.
    return false;
  }
}

export function ClientPortalRail({
  mobile = false,
  onNavigate,
}: {
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const storedCollapsed = useSyncExternalStore(subscribeToCollapse, getCollapsedSnapshot, () => false);
  const collapsed = mobile ? false : storedCollapsed;

  function toggleCollapsed() {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, String(!collapsed));
    } catch {
      // Ignored — the rail still toggles for this render, it just will not be remembered.
    }
    window.dispatchEvent(new Event(COLLAPSE_EVENT));
  }

  function handleSignOut() {
    clearClientToken();
    queryClient.removeQueries({ queryKey: ["client-auth"] });
    queryClient.removeQueries({ queryKey: ["client-overview"] });
    router.replace(`${CLIENT_PORTAL_ROUTES.login}?redirect=%2Fclient`);
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
          <Link
            href={CLIENT_PORTAL_ROUTES.home}
            onClick={onNavigate}
            className="flex min-w-0 items-center gap-2 rounded-[var(--radius-control)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-line-default bg-surface-muted">
              <span className="font-lynk text-xl leading-none text-copy-primary">L</span>
            </div>
            {/* A brand mark inside a nav link, not the page's heading — the portal carried
                this as a `font-lynk text-3xl` block on 16 pages, and on the hub it was the
                page's second h1-sized thing. `PageShell` names the page (§8). */}
            {!collapsed ? <span className="font-lynk text-2xl tracking-tight text-copy-primary">Lynk</span> : null}
          </Link>
          {!mobile ? (
            <button
              type="button"
              onClick={toggleCollapsed}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control-sm)] text-copy-muted transition-colors hover:bg-surface-muted hover:text-copy-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
          ) : null}
        </div>

        <SidebarNav>
          <SidebarMenu>
            {CLIENT_PORTAL_SECTIONS.map((section) => (
              <SidebarMenuItemLink
                key={section.href}
                href={section.href}
                label={section.label}
                icon={section.icon}
                collapsed={collapsed}
                onNavigate={onNavigate}
              />
            ))}
          </SidebarMenu>
        </SidebarNav>

        <div className="shrink-0 pt-4">
          <button
            onClick={handleSignOut}
            type="button"
            className={`flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-sm font-medium text-copy-secondary transition-colors hover:bg-surface-muted hover:text-copy-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${collapsed ? "justify-center" : ""}`}
            aria-label="Sign out"
            title={collapsed ? "Sign out" : undefined}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {collapsed ? null : <span>Sign out</span>}
          </button>
        </div>
      </div>
    </aside>
  );
}
