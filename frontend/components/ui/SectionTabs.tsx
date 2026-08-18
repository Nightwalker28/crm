"use client";

import { useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs } from "radix-ui";

import { cn } from "@/lib/utils";

export type SectionTab = {
  id: string;
  label: string;
  content: ReactNode;
};

type SectionTabsProps = {
  tabs: SectionTab[];
  defaultTabId?: string;
  className?: string;
  urlParam?: string;
  /**
   * Controlled mode, for a page that has to know which tab is open — the module builder
   * gates a field inspector on it. Supplying `value` overrides `urlParam` and local state.
   */
  value?: string;
  onValueChange?: (tabId: string) => void;
  /** Names the strip for assistive tech — "Saved view editor", "Module editor". */
  "aria-label": string;
  /**
   * `body` insets the panel to the card's content padding, so a tabbed card lines up with
   * an untabbed one. `none` is for a panel that *is* a `ModuleTableShell` — a table owns
   * its own edges and must stay full-bleed inside the card (design.md §7.7).
   */
  panelPadding?: "body" | "none";
};

/**
 * The card-scoped tab strip: a band between a `CardHeader` and the panel it switches.
 *
 * Built on Radix Tabs rather than raw buttons, because `role="tablist"` is a promise of a
 * keyboard contract rather than a styling hook — arrow keys, Home/End, a roving tabindex,
 * and `aria-controls` pointing at a real `tabpanel`. Three of this app's four strips
 * announced the role and supplied none of it, which reads worse to a screen reader than
 * the plain buttons they were made of (design.md §7.7).
 *
 * It was called `RecordTabs`, and the name is why two more pages hand-rolled a strip
 * rather than reach for it: the §4.7 record archetype builds its own strip (its tab must
 * live in `?tab=` unconditionally for R2's `/[id]/edit` round trip), so no record page has
 * used this since rebuild 5.3 batch 1. What it actually owns is the *card-scoped* case —
 * a saved-view editor, a module builder, a module's access rules — and it is named for
 * that now.
 *
 * It stays a controlled-by-URL-or-local component so the `urlParam` behaviour is unchanged
 * for callers that opted in.
 */
export function SectionTabs({
  tabs,
  defaultTabId,
  className,
  urlParam,
  panelPadding = "body",
  value: controlledValue,
  onValueChange,
  "aria-label": ariaLabel,
}: SectionTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedTabId = urlParam ? searchParams.get(urlParam) : null;
  const fallbackTabId = defaultTabId ?? tabs[0]?.id;
  const requestedIsValid = tabs.some((tab) => tab.id === requestedTabId);
  const initialTabId = requestedIsValid ? (requestedTabId as string) : fallbackTabId;
  const [localActiveTabId, setLocalActiveTabId] = useState(initialTabId);
  const activeTabId = controlledValue
    ? controlledValue
    : urlParam
      ? requestedIsValid
        ? (requestedTabId as string)
        : fallbackTabId
      : localActiveTabId;

  function selectTab(tabId: string) {
    if (controlledValue) {
      onValueChange?.(tabId);
      return;
    }
    onValueChange?.(tabId);
    if (!urlParam) {
      setLocalActiveTabId(tabId);
      return;
    }
    const nextParams = new URLSearchParams(searchParams.toString());
    if (tabId === fallbackTabId) nextParams.delete(urlParam);
    else nextParams.set(urlParam, tabId);
    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  if (!activeTabId) return null;

  return (
    <Tabs.Root
      value={activeTabId}
      onValueChange={selectTab}
      data-slot="section-tabs"
      className={cn("flex min-w-0 flex-col", className)}
    >
      {/*
       * `border-y` at the row-divider tier: this band separates a card's header from its
       * body, so it is a divider inside a panel and not a panel edge (§7.7). The container's
       * `px-3` plus the trigger's own `px-3` puts the first label on the card's 24px content
       * inset, so the strip lines up with the header above it and the panel below it.
       *
       * No vertical padding here, deliberately. The active trigger's underline has to meet
       * the band's bottom hairline, and the tidier-looking alternative — a padded band with
       * `-mb-px` pulling the underline onto the rule — walks into the trap
       * `check-design.sh` names: `overflow-x-auto` computes `overflow-y` to `auto` as well,
       * so a 1px overhang becomes scrollable overflow. 5.3 paid for that once already in
       * `RecordSpine`.
       */}
      <div className="overflow-x-auto border-y border-line-subtle px-3">
        <Tabs.List aria-label={ariaLabel} className="flex min-w-max gap-2">
          {tabs.map((tab) => (
            <Tabs.Trigger key={tab.id} value={tab.id} className={sectionTabTriggerClassName}>
              {tab.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      </div>

      {tabs.map((tab) => (
        <Tabs.Content
          key={tab.id}
          value={tab.id}
          // Radix makes the panel focusable so the keyboard can reach panel content that
          // holds no control of its own, and it is a real stop in the tab-through. So it
          // takes the §2.3 ring rather than `outline-none` with nothing behind it — the
          // defect the record archetype fixed in 5.3 batch 1 and this file still carried.
          className={cn(
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus",
            panelPadding === "body" && "px-6 py-6",
          )}
        >
          {tab.content}
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}

/**
 * The underline trigger, shared with the §4.7 record archetype.
 *
 * The archetype builds its own `Tabs.Root` for the URL contract but must not draw a
 * *different* tab: the two class lists were byte-identical duplicates, which is one
 * restyle away from two dialects. Geometry is identical on both strips — what differs is
 * the band around them, which is this file's `px-3` inset and the archetype's page-region
 * edge.
 */
export const sectionTabTriggerClassName = cn(
  "border-b-2 border-transparent px-3 py-2 text-sm font-medium text-copy-muted transition-colors",
  "hover:text-copy-primary",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
  "data-[state=active]:border-primary data-[state=active]:text-copy-primary",
);
