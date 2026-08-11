"use client";

import { useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs } from "radix-ui";

import { cn } from "@/lib/utils";

export type RecordTab = {
  id: string;
  label: string;
  content: ReactNode;
};

type RecordTabsProps = {
  tabs: RecordTab[];
  defaultTabId?: string;
  className?: string;
  urlParam?: string;
};

/**
 * Record detail tabs.
 *
 * Built on Radix Tabs rather than raw buttons: the ARIA tabs pattern needs arrow-key
 * navigation, Home/End, and a roving tabindex, and this previously announced
 * `role="tablist"` while providing none of them — which reads worse to a screen reader
 * than not claiming the role at all. Radix also wires aria-controls and
 * aria-labelledby between trigger and panel for us.
 *
 * It stays a controlled component so the URL-param behaviour below is unchanged.
 */
export function RecordTabs({ tabs, defaultTabId, className, urlParam }: RecordTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedTabId = urlParam ? searchParams.get(urlParam) : null;
  const fallbackTabId = defaultTabId ?? tabs[0]?.id;
  const requestedIsValid = tabs.some((tab) => tab.id === requestedTabId);
  const initialTabId = requestedIsValid ? (requestedTabId as string) : fallbackTabId;
  const [localActiveTabId, setLocalActiveTabId] = useState(initialTabId);
  const activeTabId = urlParam
    ? requestedIsValid
      ? (requestedTabId as string)
      : fallbackTabId
    : localActiveTabId;

  function selectTab(tabId: string) {
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
      className={cn("flex min-w-0 flex-col gap-5", className)}
    >
      <div className="overflow-x-auto border-b border-line-default">
        <Tabs.List className="flex min-w-max gap-2">
          {tabs.map((tab) => (
            <Tabs.Trigger
              key={tab.id}
              value={tab.id}
              className={cn(
                "border-b-2 border-transparent px-3 py-2 text-sm font-medium text-copy-muted transition-colors",
                "hover:text-copy-primary",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                "data-[state=active]:border-primary data-[state=active]:text-copy-primary",
              )}
            >
              {tab.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      </div>

      {tabs.map((tab) => (
        <Tabs.Content key={tab.id} value={tab.id} className="focus-visible:outline-none">
          {tab.content}
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}
