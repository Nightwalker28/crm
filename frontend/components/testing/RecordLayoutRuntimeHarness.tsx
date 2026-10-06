"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  LeadQuickCreateLayoutFields,
  leadQuickCreateInputId,
  validateLeadQuickCreateLayout,
} from "@/components/leads/LeadQuickCreateLayoutFields";
import { EMPTY_LEAD_FORM, type LeadFormValue } from "@/components/leads/LeadFormFields";
import { ReadOnlyRecordLayout } from "@/components/forms/ReadOnlyRecordLayout";
import { QuickCreateSurface } from "@/components/ui/QuickCreateSurface";
import { Button } from "@/components/ui/button";
import { useResolvedRecordLayout } from "@/hooks/useResolvedRecordLayout";

export function RecordLayoutRuntimeHarness() {
  const router = useRouter();
  const openerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<LeadFormValue>(EMPTY_LEAD_FORM);
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lastPayload, setLastPayload] = useState<Record<string, unknown> | null>(null);
  const layoutQuery = useResolvedRecordLayout("sales_leads", "quick_create");
  const detailLayoutQuery = useResolvedRecordLayout("sales_leads", "detail");
  const isDirty = useMemo(
    () => JSON.stringify([form, customValues]) !== JSON.stringify([EMPTY_LEAD_FORM, {}]),
    [customValues, form],
  );

  async function submit() {
    if (!layoutQuery.data) return;
    const nextErrors = validateLeadQuickCreateLayout(layoutQuery.data, form, customValues);
    setErrors(nextErrors);
    const firstInvalidField = Object.keys(nextErrors)[0];
    if (firstInvalidField) {
      window.requestAnimationFrame(() => {
        document.getElementById(leadQuickCreateInputId(firstInvalidField))?.focus();
      });
      return;
    }
    setLastPayload({ ...form, custom_fields: customValues });
  }

  return (
    <main className="min-h-screen bg-app p-6 text-copy-primary">
      <Button ref={openerRef} type="button" onClick={() => setOpen(true)}>
        Open resolved Lead Quick Create
      </Button>
      <pre data-testid="last-layout-payload" className="mt-4 whitespace-pre-wrap text-xs">
        {lastPayload ? JSON.stringify(lastPayload) : "none"}
      </pre>
      <section aria-label="Resolved Lead Details proof" className="mt-8 max-w-4xl">
        {detailLayoutQuery.data ? (
          <ReadOnlyRecordLayout
            layout={detailLayoutQuery.data}
            values={{
              company: "Lynk QA",
              primary_email: "layout.fixture@example.test",
              phone: "+94770000000",
              status: "qualified",
              tags: ["Enterprise", "Warm"],
            }}
            customValues={{ renewal_tier: "Gold" }}
          />
        ) : detailLayoutQuery.error ? (
          <div role="alert">The Lead Details layout could not be loaded.</div>
        ) : (
          <div role="status">Loading Lead Details layout…</div>
        )}
      </section>

      <QuickCreateSurface
        open={open}
        onOpenChange={setOpen}
        title="Create lead"
        description="Runtime metadata renderer proof."
        returnFocusRef={openerRef}
        isDirty={isDirty}
        isLoading={layoutQuery.isLoading}
        error={layoutQuery.error ? "The Lead Quick Create layout could not be loaded." : null}
        validationSummary={Object.keys(errors).length ? "Complete the required fields." : null}
        statusMessage={isDirty ? "Unsaved changes" : "Ready to create"}
        onSubmit={submit}
        onMoreDetails={() => router.push("/dashboard/sales/leads/new")}
      >
        {layoutQuery.data ? (
          <LeadQuickCreateLayoutFields
            layout={layoutQuery.data}
            value={form}
            onChange={setForm}
            customValues={customValues}
            onCustomChange={(fieldKey, value) => {
              setCustomValues((current) => ({ ...current, [fieldKey]: value }));
            }}
            errors={errors}
          />
        ) : null}
      </QuickCreateSurface>
    </main>
  );
}
