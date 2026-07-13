"use client";

import { useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

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

export function RecordTabs({ tabs, defaultTabId, className, urlParam }: RecordTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedTabId = urlParam ? searchParams.get(urlParam) : null;
  const initialTabId = tabs.some((tab) => tab.id === requestedTabId) ? requestedTabId as string : defaultTabId ?? tabs[0]?.id;
  const [localActiveTabId, setLocalActiveTabId] = useState(initialTabId);
  const activeTabId = urlParam ? (tabs.some((tab) => tab.id === requestedTabId) ? requestedTabId as string : defaultTabId ?? tabs[0]?.id) : localActiveTabId;
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  function selectTab(tabId: string) {
    if (!urlParam) {
      setLocalActiveTabId(tabId);
      return;
    }
    const nextParams = new URLSearchParams(searchParams.toString());
    if (tabId === (defaultTabId ?? tabs[0]?.id)) nextParams.delete(urlParam);
    else nextParams.set(urlParam, tabId);
    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-5", className)}>
      <div className="overflow-x-auto border-b border-neutral-800">
        <div className="flex min-w-max gap-2" role="tablist">
          {tabs.map((tab) => {
            const active = tab.id === activeTab?.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => selectTab(tab.id)}
                role="tab"
                aria-selected={active}
                aria-controls={`record-tab-panel-${tab.id}`}
                className={cn(
                  "border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "border-neutral-100 text-neutral-100"
                    : "border-transparent text-neutral-500 hover:text-neutral-200",
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div id={activeTab ? `record-tab-panel-${activeTab.id}` : undefined} role="tabpanel" aria-label={activeTab?.label}>{activeTab?.content}</div>
    </div>
  );
}
