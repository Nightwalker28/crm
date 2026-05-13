"use client";

import { useState, type ReactNode } from "react";

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
};

export function RecordTabs({ tabs, defaultTabId, className }: RecordTabsProps) {
  const [activeTabId, setActiveTabId] = useState(defaultTabId ?? tabs[0]?.id);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  return (
    <div className={cn("flex min-w-0 flex-col gap-5", className)}>
      <div className="overflow-x-auto border-b border-neutral-800">
        <div className="flex min-w-max gap-2">
          {tabs.map((tab) => {
            const active = tab.id === activeTab?.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTabId(tab.id)}
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

      <div>{activeTab?.content}</div>
    </div>
  );
}
