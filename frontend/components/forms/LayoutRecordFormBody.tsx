"use client";

import type { ComponentProps } from "react";

import { RecordForm, type RecordFormValue } from "@/components/forms/RecordForm";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useResolvedRecordLayout, type RecordLayoutSurface } from "@/hooks/useResolvedRecordLayout";

type Props<TValue extends RecordFormValue> = Omit<ComponentProps<typeof RecordForm<TValue>>, "layout"> & {
  /** `full_form` on `/new` and `/[id]/edit` (13b Phase 4e). */
  surface?: RecordLayoutSurface;
};

/**
 * A full create or edit form drawn from the tenant's `full_form` layout (13b Phase 4 slice
 * 4e): the layout arranges the fields — per role and team — and `RecordForm` draws them. The
 * page keeps its own header, footer, save and validation; this is the body between them.
 */
export function LayoutRecordFormBody<TValue extends RecordFormValue>({ surface = "full_form", ...props }: Props<TValue>) {
  const layoutQuery = useResolvedRecordLayout(props.moduleKey, surface);
  if (layoutQuery.isLoading) {
    return <p className="text-sm text-copy-muted" aria-busy="true">Loading the form…</p>;
  }
  if (!layoutQuery.data) {
    return (
      <EmptyState
        title="This form could not be loaded"
        description="Nothing has been changed. Try again."
        action={<Button variant="outline" onClick={() => void layoutQuery.refetch()}>Try again</Button>}
      />
    );
  }
  return <RecordForm<TValue> layout={layoutQuery.data} {...props} />;
}
