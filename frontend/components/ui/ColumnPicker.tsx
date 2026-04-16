"use client";

import { ArrowDown, ArrowUp, EyeOff, Settings2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TableColumnOption } from "@/hooks/useTablePreferences";

type Props = {
  title?: string;
  options: TableColumnOption[];
  visibleColumns: string[];
  onChange: (visibleColumns: string[]) => Promise<unknown> | unknown;
  className?: string;
  forceOpen?: boolean;
};

export function ColumnPicker({
  title = "Columns",
  options,
  visibleColumns,
  onChange,
  className,
  forceOpen = false,
}: Props) {
  const [open, setOpen] = useState(false);

  const hiddenColumns = options.filter((option) => !visibleColumns.includes(option.key));
  const orderedVisibleOptions = visibleColumns
    .map((key) => options.find((option) => option.key === key))
    .filter((option): option is TableColumnOption => Boolean(option));

  async function toggleColumn(columnKey: string) {
    const next = visibleColumns.includes(columnKey)
      ? visibleColumns.filter((key) => key !== columnKey)
      : [...visibleColumns, columnKey];

    if (!next.length) {
      return;
    }

    await onChange(next);
  }

  async function moveColumn(columnKey: string, direction: "up" | "down") {
    const currentIndex = visibleColumns.indexOf(columnKey);
    if (currentIndex === -1) return;

    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= visibleColumns.length) return;

    const next = [...visibleColumns];
    const [column] = next.splice(currentIndex, 1);
    next.splice(targetIndex, 0, column);
    await onChange(next);
  }

  return (
    <div className={cn("relative", className)}>
      {!forceOpen ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen((value) => !value)}
        >
          <Settings2 className="h-4 w-4" />
          {title}
        </Button>
      ) : null}

      {(forceOpen || open) && (
        <div
          className={cn(
            "w-64 rounded-xl border border-neutral-800 bg-neutral-950 p-3 shadow-2xl",
            forceOpen ? "static shadow-none" : "absolute right-0 top-11 z-30",
          )}
        >
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Visible columns
          </div>
          <div className="space-y-3">
            <div className="space-y-2">
              {orderedVisibleOptions.map((option, index) => (
                <div
                  key={option.key}
                  className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-neutral-200 hover:bg-neutral-900"
                >
                  <button
                    type="button"
                    onClick={() => void toggleColumn(option.key)}
                    className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
                    title="Hide column"
                  >
                    <EyeOff className="h-4 w-4" />
                  </button>
                  <span className="flex-1">{option.label}</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void moveColumn(option.key, "up")}
                      disabled={index === 0}
                      className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-30"
                      title="Move up"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void moveColumn(option.key, "down")}
                      disabled={index === orderedVisibleOptions.length - 1}
                      className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-30"
                      title="Move down"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {hiddenColumns.length ? (
              <>
                <div className="border-t border-neutral-800 pt-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Hidden columns
                </div>
                <div className="space-y-2">
                  {hiddenColumns.map((option) => (
                    <label
                      key={option.key}
                      className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm text-neutral-200 hover:bg-neutral-900"
                    >
                      <input
                        type="checkbox"
                        checked={false}
                        onChange={() => void toggleColumn(option.key)}
                        className="h-4 w-4 rounded border-neutral-700 bg-neutral-900"
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
