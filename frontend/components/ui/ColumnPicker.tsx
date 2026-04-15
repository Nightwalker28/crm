"use client";

import { Settings2 } from "lucide-react";
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
};

export function ColumnPicker({
  title = "Columns",
  options,
  visibleColumns,
  onChange,
  className,
}: Props) {
  const [open, setOpen] = useState(false);

  async function toggleColumn(columnKey: string) {
    const next = visibleColumns.includes(columnKey)
      ? visibleColumns.filter((key) => key !== columnKey)
      : [...visibleColumns, columnKey];

    if (!next.length) {
      return;
    }

    await onChange(next);
  }

  return (
    <div className={cn("relative", className)}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((value) => !value)}
      >
        <Settings2 className="h-4 w-4" />
        {title}
      </Button>

      {open && (
        <div className="absolute right-0 top-11 z-30 w-64 rounded-xl border border-neutral-800 bg-neutral-950 p-3 shadow-2xl">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Visible columns
          </div>
          <div className="space-y-2">
            {options.map((option) => {
              const checked = visibleColumns.includes(option.key);
              return (
                <label
                  key={option.key}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm text-neutral-200 hover:bg-neutral-900"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => void toggleColumn(option.key)}
                    className="h-4 w-4 rounded border-neutral-700 bg-neutral-900"
                  />
                  <span>{option.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
