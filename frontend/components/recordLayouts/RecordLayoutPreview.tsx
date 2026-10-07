"use client";

import { useState } from "react";
import { Monitor, Smartphone } from "lucide-react";

import { RecordForm, recordFormDraws, type RecordFormValue } from "@/components/forms/RecordForm";
import { ResolvedRecordLayout } from "@/components/forms/ResolvedRecordLayout";
import { EMPTY_LEAD_FORM, type LeadFormValue } from "@/components/leads/LeadFormFields";
import { LeadQuickCreateLayoutFields } from "@/components/leads/LeadQuickCreateLayoutFields";
import { SegmentedControl, SegmentedItem } from "@/components/ui/SegmentedControl";
import { EmptyState } from "@/components/ui/EmptyState";
import { EMPTY_FIELD_VALUE } from "@/components/ui/EmptyValue";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RequiredMark } from "@/components/ui/RequiredMark";
import type { ResolvedRecordLayout as ResolvedRecordLayoutContract } from "@/lib/contracts/recordLayouts";
import type { ResolvedRecordLayoutField } from "@/hooks/useResolvedRecordLayout";
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
  layout: ResolvedRecordLayoutContract | null;
  isStale: boolean;
}) {
  // Lead quick create renders through its own runtime form; every other create surface through
  // `RecordForm` (13b Phase 4e), the renderer the pages use. A field only a module's own
  // control can draw (a deal's stage, a document status) shows as a placeholder. Details
  // show their structure: values exist only once a record is open.
  const isLeadQuickCreate = layout?.module_key === "sales_leads" && layout.surface === "quick_create";
  const isLiveForm = isLeadQuickCreate || layout?.surface === "quick_create" || layout?.surface === "full_form";
  const [viewport, setViewport] = useState<PreviewViewport>("desktop");
  const [value, setValue] = useState<LeadFormValue>(EMPTY_LEAD_FORM);
  const [formValue, setFormValue] = useState<RecordFormValue>({});
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});
  const previewInputId = (fieldKey: string) => `layout-preview-${fieldKey.replace(/[^a-z0-9_-]/gi, "-")}`;
  const placeholderField = (field: ResolvedRecordLayoutField, surface: string) => {
    const id = previewInputId(field.field_key);
    return (
      <Field>
        <FieldLabel htmlFor={id}>
          {field.label}
          {field.required && surface !== "detail" ? <RequiredMark /> : null}
        </FieldLabel>
        <Input id={id} value="" placeholder={field.readonly ? EMPTY_FIELD_VALUE : field.placeholder ?? ""} disabled readOnly />
      </Field>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-p-xs text-copy-muted">
          {isLiveForm
            ? `Live preview of the ${layout?.surface === "full_form" ? "create and edit form" : "quick create"}. Nothing typed here is saved.`
            : layout?.surface === "detail"
              ? "Preview of the details layout. Values show once a record is open."
              : "Preview of the form's fields and order."}
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
          {isLeadQuickCreate ? (
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
          ) : isLiveForm ? (
            <RecordForm
              key={`${layout.module_key}:${layout.surface}`}
              moduleKey={layout.module_key}
              layout={layout}
              viewport={viewport === "mobile" ? "mobile" : "auto"}
              value={formValue}
              onChange={setFormValue}
              customValues={customValues}
              onCustomChange={(fieldKey, fieldValue) =>
                setCustomValues((current) => ({ ...current, [fieldKey]: fieldValue }))
              }
              inputId={previewInputId}
              renderField={(field) => (recordFormDraws(field) ? undefined : placeholderField(field, layout.surface))}
            />
          ) : (
            <ResolvedRecordLayout
              layout={layout}
              viewport={viewport === "mobile" ? "mobile" : "auto"}
              renderField={(field) => placeholderField(field, layout.surface)}
            />
          )}
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
