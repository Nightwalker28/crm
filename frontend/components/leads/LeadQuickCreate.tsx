"use client";

import { type RefObject, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { EMPTY_LEAD_FORM, type LeadFormValue } from "@/components/leads/LeadFormFields";
import {
  LeadQuickCreateLayoutFields,
  leadQuickCreateInputId,
  validateLeadQuickCreateLayout,
} from "@/components/leads/LeadQuickCreateLayoutFields";
import {
  LeadMutationError,
  buildLeadPayload,
  saveLead,
  validateLeadEmail,
} from "@/components/leads/leadMutation";
import {
  LEAD_QUICK_CREATE_HANDOFF_ROUTE,
  saveLeadQuickCreateDraft,
} from "@/components/leads/leadQuickCreateDraft";
import { QuickCreateSurface, type QuickCreateOutcome } from "@/components/ui/QuickCreateSurface";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { RecordLayoutContractError, useResolvedRecordLayout } from "@/hooks/useResolvedRecordLayout";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Focus returns here when the surface closes. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** Called after a successful create so the list can refetch its current page in place. */
  onCreated: (leadId: number | null) => void;
};

const EMPTY_STATE_SNAPSHOT = JSON.stringify([EMPTY_LEAD_FORM, {}]);

function layoutErrorMessage(error: unknown) {
  if (error instanceof RecordLayoutContractError && error.status === 403) {
    return "You no longer have permission to create leads. Ask an administrator to restore access.";
  }
  if (error instanceof RecordLayoutContractError && error.kind === "malformed_response") {
    return "The Lead Quick Create layout could not be read. Use More details to create this lead on the full form.";
  }
  return "The Lead Quick Create layout could not be loaded. Use More details to create this lead on the full form.";
}

function submitErrorMessage(error: unknown) {
  if (!(error instanceof LeadMutationError)) {
    return "We could not reach the server. Your entries are still here — try again.";
  }
  // 400/409 carry a specific domain reason: duplicate email, a rejected owner or team, or a
  // tag/status the domain refused. Those are worth showing verbatim.
  if (error.detail && (error.status === 400 || error.status === 409)) return error.detail;
  if (error.status === 403) {
    return "You do not have permission to create leads. Ask an administrator to restore access.";
  }
  return "The lead could not be created. Check the fields and try again.";
}

export function LeadQuickCreate({ open, onOpenChange, returnFocusRef, onCreated }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<LeadFormValue>(EMPTY_LEAD_FORM);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Only fetched once the surface is opened; the list should not pay for a layout nobody asked for.
  const layoutQuery = useResolvedRecordLayout("sales_leads", "quick_create", open);
  const { fields: moduleFields } = useModuleFieldConfigs("sales_leads");
  const layout = layoutQuery.data;

  const isDirty = useMemo(
    () => JSON.stringify([form, customFieldValues]) !== EMPTY_STATE_SNAPSHOT,
    [customFieldValues, form],
  );

  const reset = useCallback(() => {
    setForm(EMPTY_LEAD_FORM);
    setCustomFieldValues({});
    setErrors({});
    setSubmitError(null);
  }, []);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  function focusFirstInvalidField(nextErrors: Record<string, string>) {
    const firstInvalidField = Object.keys(nextErrors)[0];
    if (!firstInvalidField) return;
    window.requestAnimationFrame(() => {
      document.getElementById(leadQuickCreateInputId(firstInvalidField))?.focus();
    });
  }

  /**
   * Requiredness comes from the resolved layout, which the backend derives from the domain
   * field catalog. Only the email format check is added here, and it matches the full form.
   */
  function validate() {
    if (!layout) return { layout_unavailable: "The layout is still loading." };
    const nextErrors: Record<string, string> = validateLeadQuickCreateLayout(layout, form, customFieldValues);
    if (!nextErrors.primary_email) {
      const hasEmailField = layout.sections.some((section) =>
        section.fields.some((field) => field.field_key === "primary_email" && field.visible),
      );
      const emailError = hasEmailField ? validateLeadEmail(form.primary_email) : null;
      if (emailError) nextErrors.primary_email = emailError;
    }
    return nextErrors;
  }

  async function handleSubmit(outcome: QuickCreateOutcome) {
    setSubmitError(null);
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      focusFirstInvalidField(nextErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      const leadId = await saveLead({
        mode: "create",
        payload: buildLeadPayload(form, customFieldValues, moduleFields),
      });
      await queryClient.invalidateQueries({ queryKey: ["sales-leads"] });
      toast.success("Lead created.");
      onCreated(leadId);
      // Closing directly rather than through the dirty guard: the entered data was saved.
      onOpenChange(false);
      reset();
      if (outcome === "create-and-open" && leadId !== null) {
        router.push(`/dashboard/sales/leads/${leadId}`);
      }
    } catch (error) {
      setSubmitError(submitErrorMessage(error));
      // A duplicate is always an email collision, so put the cursor where the fix is.
      if (error instanceof LeadMutationError && error.status === 409) {
        window.requestAnimationFrame(() => {
          document.getElementById(leadQuickCreateInputId("primary_email"))?.focus();
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleMoreDetails() {
    saveLeadQuickCreateDraft({ form, customFieldValues });
    onOpenChange(false);
    reset();
    router.push(LEAD_QUICK_CREATE_HANDOFF_ROUTE);
  }

  const invalidFieldCount = Object.keys(errors).length;

  return (
    <QuickCreateSurface
      open={open}
      onOpenChange={onOpenChange}
      title="Create lead"
      description="Capture the essentials now. The full form stays available under More details."
      returnFocusRef={returnFocusRef}
      isDirty={isDirty}
      isPending={isSubmitting}
      isLoading={layoutQuery.isLoading}
      error={submitError ?? (layoutQuery.error ? layoutErrorMessage(layoutQuery.error) : null)}
      validationSummary={
        invalidFieldCount
          ? `Complete ${invalidFieldCount} required ${invalidFieldCount === 1 ? "field" : "fields"} to create this lead.`
          : null
      }
      statusMessage={isDirty ? "Unsaved changes" : "Ready to create"}
      onSubmit={handleSubmit}
      onMoreDetails={handleMoreDetails}
      discardTitle="Discard this lead?"
      discardDescription="The details you entered here have not been saved."
    >
      {layout ? (
        <LeadQuickCreateLayoutFields
          layout={layout}
          value={form}
          onChange={setForm}
          customValues={customFieldValues}
          onCustomChange={(fieldKey, value) =>
            setCustomFieldValues((current) => ({ ...current, [fieldKey]: value }))
          }
          errors={errors}
        />
      ) : null}
    </QuickCreateSurface>
  );
}
