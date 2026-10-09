"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";

import { ClientAccountMenu } from "@/components/client-portal/ClientAccountMenu";
import { ClientPortalRail } from "@/components/client-portal/ClientPortalRail";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetOverlay, SheetPortal, SheetTitle } from "@/components/ui/sheet";
import { CLIENT_PORTAL_SECTIONS, isPortalChromeRoute } from "@/lib/client-portal-nav";

/**
 * The portal's shell — the file whose absence was the root cause of the whole layer
 * (rebuild 5.8). Sixteen pages each opened with `min-h-screen bg-app`, a centred container
 * at one of six widths, and a header holding the wordmark and whatever single link that
 * page's author thought you would want next. None of them was navigation.
 *
 * The mechanism is the dashboard's, not a variation on it: a full-height row whose content
 * column owns the scroll, so the page itself never scrolls and §4.5 holds at one page scroll
 * region. Ruling 4 puts the container width here — no page under this sets a `max-w-*` on
 * its root.
 *
 * **No hive.** §9 licenses the lattice on the portal's *door* and nowhere past it: the
 * interior is a surface a customer works inside.
 */
function portalSectionLabel(pathname: string) {
  return CLIENT_PORTAL_SECTIONS.find(
    (section) => pathname === section.href || pathname.startsWith(`${section.href}/`),
  )?.label;
}

export default function ClientPortalLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);

  // The doors and the tenant-branded shared page render bare — see `isPortalChromeRoute`.
  if (!isPortalChromeRoute(pathname)) return <>{children}</>;

  const sectionLabel = portalSectionLabel(pathname);

  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-app font-sans text-copy-secondary">
      <ClientPortalRail />
      <Sheet open={mobileNavigationOpen} onOpenChange={setMobileNavigationOpen}>
        <SheetPortal>
          <SheetOverlay className="fixed inset-0 z-40 bg-overlay md:hidden" />
          <SheetContent side="left" className="z-50 w-72 max-w-[85vw] outline-none md:hidden">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <ClientPortalRail mobile onNavigate={() => setMobileNavigationOpen(false)} />
          </SheetContent>
        </SheetPortal>
      </Sheet>

      <main className="relative z-10 flex min-w-0 flex-1 overflow-hidden">
        <div className="flex h-full w-full min-w-0 flex-col overflow-hidden">
          <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-line-subtle px-4 py-3 sm:px-6">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="md:hidden"
              aria-label="Open navigation"
              aria-expanded={mobileNavigationOpen}
              onClick={() => setMobileNavigationOpen(true)}
            >
              <Menu />
            </Button>
            {/* Not an h1: this names the *section*, and `PageShell` names the page — exactly
                one h1 per page (§8). The dashboard header makes the same call. */}
            {sectionLabel ? <div className="truncate text-sm font-semibold text-copy-primary">{sectionLabel}</div> : null}
            <ClientAccountMenu />
          </header>
          <div className="scrollbar-hide h-full w-full overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
            {/* Ruling 4 — the layout owns the width. Six of them drifted because every page
                set its own.

                `flex h-full flex-col` is load-bearing, not cosmetic: `PageShell
                variant="record"` asks for `lg:h-full`, and `height: 100%` against an
                auto-height parent resolves to `auto`. Without it every portal record page
                silently reverted to a document scroll — the archetype's contract is that the
                content region is the only scroller (R9), and the wrapper is what carries the
                height down to it. */}
            <div className="mx-auto flex h-full w-full max-w-6xl flex-col">{children}</div>
          </div>
        </div>
      </main>
    </div>
  );
}
