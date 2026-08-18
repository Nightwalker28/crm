"use client";

import { AlignJustify, Rows3 } from "lucide-react";

import { SegmentedControl, SegmentedItem } from "@/components/ui/SegmentedControl";
import { setTableDensity, useTableDensity } from "@/hooks/useTableDensity";

export function TableDensityToggle() {
  const density = useTableDensity();
  return (
    <SegmentedControl
      aria-label="Table density"
      value={density}
      onValueChange={(next) => setTableDensity(next as "comfortable" | "compact")}
    >
      <SegmentedItem value="comfortable" iconOnly aria-label="Comfortable table density">
        <Rows3 />
      </SegmentedItem>
      <SegmentedItem value="compact" iconOnly aria-label="Compact table density">
        <AlignJustify />
      </SegmentedItem>
    </SegmentedControl>
  );
}
