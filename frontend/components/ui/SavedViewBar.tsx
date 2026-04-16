"use client";

import { Save, Star, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SavedView } from "@/hooks/useSavedViews";

type Props = {
  title?: string;
  views: SavedView[];
  selectedViewId: string;
  onSelect: (viewId: string) => void;
  onSaveCurrent: () => Promise<unknown> | unknown;
  onSaveAsNew: () => Promise<unknown> | unknown;
  onSetDefault: () => Promise<unknown> | unknown;
  onDelete: () => Promise<unknown> | unknown;
  disableSaveCurrent?: boolean;
  disableDelete?: boolean;
  isSaving?: boolean;
};

export function SavedViewBar({
  title = "View",
  views,
  selectedViewId,
  onSelect,
  onSaveCurrent,
  onSaveAsNew,
  onSetDefault,
  onDelete,
  disableSaveCurrent = false,
  disableDelete = false,
  isSaving = false,
}: Props) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-950/60 px-4 py-3 md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</div>
        <div className="flex items-center gap-3">
          <Select value={selectedViewId} onValueChange={onSelect}>
            <SelectTrigger className="w-full min-w-56 md:w-72">
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
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void onSaveAsNew()} disabled={isSaving}>
          Save as New
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => void onSaveCurrent()} disabled={disableSaveCurrent || isSaving}>
          <Save className="h-4 w-4" />
          Save Changes
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => void onSetDefault()} disabled={disableSaveCurrent || isSaving}>
          <Star className="h-4 w-4" />
          Set Default
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => void onDelete()} disabled={disableDelete || isSaving}>
          <Trash2 className="h-4 w-4" />
          Delete
        </Button>
      </div>
    </div>
  );
}
