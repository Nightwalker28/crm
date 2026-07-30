"use client";

import Link from "next/link";
import { SlidersHorizontal, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { SavedView } from "@/hooks/useSavedViews";

type Props = {
  moduleKey: string;
  views: SavedView[];
  selectedViewId: string;
  onSelect: (viewId: string) => void;
};

export function SavedViewSelector({ moduleKey, views, selectedViewId, onSelect }: Props) {
  const hasSelectedView = views.some((view) => String(view.id ?? "system-default") === selectedViewId);
  const effectiveViewId = hasSelectedView
    ? selectedViewId
    : String((views.find((view) => view.is_default) ?? views[0])?.id ?? "system-default");

  return (
    <div className="flex min-w-0 items-center gap-1" aria-label="Saved views">
      <div
        className="scrollbar-hide flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        role="tablist"
        aria-label="Record views"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
          const currentIndex = tabs.indexOf(document.activeElement as HTMLButtonElement);
          if (currentIndex < 0 || !tabs.length) return;
          event.preventDefault();
          const nextIndex =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? tabs.length - 1
                : event.key === "ArrowRight"
                  ? (currentIndex + 1) % tabs.length
                  : (currentIndex - 1 + tabs.length) % tabs.length;
          tabs[nextIndex]?.focus();
          tabs[nextIndex]?.click();
        }}
      >
        {views.map((view) => {
          const viewId = String(view.id ?? "system-default");
          const selected = viewId === effectiveViewId;
          return (
            <button
              key={viewId}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => {
                if (!selected) onSelect(viewId);
              }}
              className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--radius-control-sm)] px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                selected
                  ? "bg-action-primary-muted text-primary"
                  : "text-copy-secondary hover:bg-surface-muted hover:text-copy-primary"
              }`}
            >
              {view.is_default ? <Star className="h-3.5 w-3.5 fill-current" aria-label="Default view" /> : null}
              {view.name}
            </button>
          );
        })}
      </div>
      <Button asChild type="button" variant="ghost" size="sm" className="shrink-0">
        <Link href={`/dashboard/views/${moduleKey}?viewId=${effectiveViewId}`} aria-label="Manage views">
          <SlidersHorizontal className="h-4 w-4" />
          <span className="hidden sm:inline">Manage views</span>
        </Link>
      </Button>
    </div>
  );
}
