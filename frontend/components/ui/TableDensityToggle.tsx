"use client";

import { AlignJustify, Rows3 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { setTableDensity, useTableDensity } from "@/hooks/useTableDensity";

export function TableDensityToggle() {
  const density = useTableDensity();
  return (
    <div className="inline-flex rounded-[var(--radius-control)] border border-line-default bg-surface p-0.5" role="group" aria-label="Table density">
      <Button type="button" variant={density === "comfortable" ? "secondary" : "ghost"} size="icon-sm" className="h-7 w-7" aria-label="Comfortable table density" aria-pressed={density === "comfortable"} title="Comfortable density" onClick={() => setTableDensity("comfortable")}><Rows3 /></Button>
      <Button type="button" variant={density === "compact" ? "secondary" : "ghost"} size="icon-sm" className="h-7 w-7" aria-label="Compact table density" aria-pressed={density === "compact"} title="Compact density" onClick={() => setTableDensity("compact")}><AlignJustify /></Button>
    </div>
  );
}
