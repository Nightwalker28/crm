"use client";

import { useState } from "react";
import { Monitor, Smartphone } from "lucide-react";

import { EMPTY_LEAD_FORM, type LeadFormValue } from "@/components/leads/LeadFormFields";
import { LeadQuickCreateLayoutFields } from "@/components/leads/LeadQuickCreateLayoutFields";
import { SegmentedControl, SegmentedItem } from "@/components/ui/SegmentedControl";
import { EmptyState } from "@/components/ui/EmptyState";
import type { ResolvedRecordLayout } from "@/lib/contracts/recordLayouts";
import { cn } from "@/lib/utils";

type PreviewViewport = "desktop" | "mobile";

/**
 * Renders the candidate layout through the *runtime* renderer, not a builder-specific
 * mock — the preview is only trustworthy if a mistake here would also be a mistake in Quick
 * Create. The layout comes from the server's preview endpoint, so field labels, required
 * flags and read-only flags are resolved exactly as the real surface resolves them.
 *
 * The inputs are live so an administrator can feel the tab order and control sizes; nothing
 * is submitted anywhere.
 */
export function RecordLayoutPreview({
  layout,
  isStale,
}: {
  layout: ResolvedRecordLayout | null;
  isStale: boolean;
}) {
  const [viewport, setViewport] = useState<PreviewViewport>("desktop");
  const [value, setValue] = useState<LeadFormValue>(EMPTY_LEAD_FORM);
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-p-xs text-copy-muted">
          Live preview of Quick Create. Nothing typed here is saved.
        </p>
        <SegmentedControl aria-label="Preview viewport" value={viewport} onValueChange={setViewport}>
          <SegmentedItem value="desktop"><Monitor />Desktop</SegmentedItem>
          <SegmentedItem value="mobile"><Smartphone />Mobile</SegmentedItem>
        </SegmentedControl>
      </div>

      {layout ? (
        <div
          // No frame of its own: the runtime renderer already puts each section in a card, and
          // wrapping those in another bordered, tinted box makes three visible container
          // levels (design.md 1.3). The mobile width is what communicates the viewport.
          className={cn(
            "transition-opacity",
            viewport === "mobile" && "mx-auto w-full max-w-[26rem]",
            isStale && "opacity-60",
          )}
          data-layout-preview={viewport}
          aria-busy={isStale}
        >
          <LeadQuickCreateLayoutFields
            layout={layout}
            viewport={viewport === "mobile" ? "mobile" : "auto"}
            value={value}
            onChange={setValue}
            customValues={customValues}
            onCustomChange={(fieldKey, fieldValue) =>
              setCustomValues((current) => ({ ...current, [fieldKey]: fieldValue }))
            }
          />
        </div>
      ) : (
        <EmptyState
          title="No preview available"
          description="Fix the problems listed above and the preview will reappear."
        />
      )}
    </div>
  );
}
