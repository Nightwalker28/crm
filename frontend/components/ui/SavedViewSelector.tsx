"use client";

import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
    <div className="flex items-center gap-3">
      <Select value={effectiveViewId} onValueChange={(value) => {
        if (value !== selectedViewId) {
          onSelect(value);
        }
      }}>
        <SelectTrigger className="w-56">
          <SelectValue placeholder="Select view" />
        </SelectTrigger>
        <SelectContent>
          {views.map((view) => (
            <SelectItem key={String(view.id ?? "system-default")} value={String(view.id ?? "system-default")}>
              {view.name}{view.is_default ? " (Default)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button asChild type="button" variant="outline" size="sm">
        <Link href={`/dashboard/views/${moduleKey}?viewId=${effectiveViewId}`}>
          <SlidersHorizontal className="h-4 w-4" />
          Manage View
        </Link>
      </Button>
    </div>
  );
}
