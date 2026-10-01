"use client";

import { type RefObject } from "react";
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
import { useQuickCreateRecord } from "@/hooks/useQuickCreateRecord";
import { RecordLayoutContractError } from "@/hooks/useResolvedRecordLayout";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Focus returns here when the surface closes. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** Called after a successful create so the list can refetch its current page in place. */
  onCreated: (leadId: number | null) => void;
};

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
    return { message: "We could not reach the server. Your entries are still here — try again." };
  }
  // 400/409 carry a specific domain reason: duplicate email, a rejected owner or team, or a
  // tag/status the domain refused. Those are worth showing verbatim.
  if (error.detail && (error.status === 400 || error.status === 409)) {
    return {
      message: error.detail,
      focusFieldKey: error.status === 409 ? "primary_email" : undefined,
    };
  }
  if (error.status === 403) {
    return { message: "You do not have permission to create leads. Ask an administrator to restore access." };
  }
  return { message: "The lead could not be created. Check the fields and try again." };
}

export function LeadQuickCreate({ open, onOpenChange, returnFocusRef, onCreated }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const quickCreate = useQuickCreateRecord<LeadFormValue>({
    moduleKey: "sales_leads",
    open,
    emptyForm: EMPTY_LEAD_FORM,
    inputId: leadQuickCreateInputId,
    validate: ({ layout, form, customFieldValues }) => {
      const nextErrors = validateLeadQuickCreateLayout(layout, form, customFieldValues);
      if (!nextErrors.primary_email) {
        const hasEmailField = layout.sections.some((section) =>
          section.fields.some((field) => field.field_key === "primary_email" && field.visible),
        );
        const emailError = hasEmailField ? validateLeadEmail(form.primary_email) : null;
        if (emailError) nextErrors.primary_email = emailError;
      }
      return nextErrors;
    },
    save: ({ form, customFieldValues, moduleFields }) => saveLead({
      mode: "create",
      payload: buildLeadPayload(form, customFieldValues, moduleFields),
    }),
    onCreated: async (leadId, outcome) => {
      await queryClient.invalidateQueries({ queryKey: ["sales-leads"] });
      toast.success("Lead created.");
      onCreated(leadId);
      onOpenChange(false);
      quickCreate.reset();
      if (outcome === "create-and-open" && leadId !== null) {
        router.push(`/dashboard/sales/leads/${leadId}`);
      }
    },
    describeSubmitError: submitErrorMessage,
  });

  function handleMoreDetails() {
    saveLeadQuickCreateDraft({
      form: quickCreate.form,
      customFieldValues: quickCreate.customFieldValues,
    });
    onOpenChange(false);
    quickCreate.reset();
    router.push(LEAD_QUICK_CREATE_HANDOFF_ROUTE);
  }

  const { invalidFieldCount, layout, layoutQuery } = quickCreate;

  return (
    <QuickCreateSurface
      open={open}
      onOpenChange={onOpenChange}
      title="Create lead"
      description="Capture the essentials now. The full form stays available under More details."
      returnFocusRef={returnFocusRef}
      isDirty={quickCreate.isDirty}
      isPending={quickCreate.isSubmitting}
      isLoading={layoutQuery.isLoading}
      error={quickCreate.submitError ?? (layoutQuery.error ? layoutErrorMessage(layoutQuery.error) : null)}
      validationSummary={
        invalidFieldCount
          ? `Complete ${invalidFieldCount} required ${invalidFieldCount === 1 ? "field" : "fields"} to create this lead.`
          : null
      }
      statusMessage={quickCreate.isDirty ? "Unsaved changes" : "Ready to create"}
      onSubmit={(outcome: QuickCreateOutcome) => quickCreate.handleSubmit(outcome)}
      onMoreDetails={handleMoreDetails}
      discardTitle="Discard this lead?"
      discardDescription="The details you entered here have not been saved."
    >
      {layout ? (
        <LeadQuickCreateLayoutFields
          layout={layout}
          value={quickCreate.form}
          onChange={quickCreate.setForm}
          customValues={quickCreate.customFieldValues}
          onCustomChange={quickCreate.setCustomFieldValue}
          errors={quickCreate.errors}
        />
      ) : null}
    </QuickCreateSurface>
  );
}
