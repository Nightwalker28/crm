"use client";

import { type RefObject } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  EMPTY_OPPORTUNITY_FORM,
  type OpportunityFormValue,
} from "@/components/opportunities/OpportunityFormFields";
import {
  OpportunityQuickCreateLayoutFields,
  opportunityQuickCreateInputId,
  validateOpportunityQuickCreateLayout,
} from "@/components/opportunities/OpportunityQuickCreateLayoutFields";
import {
  OpportunityMutationError,
  buildOpportunityPayload,
  saveOpportunity,
  validateOpportunityContact,
  validateOpportunityName,
} from "@/components/opportunities/opportunityMutation";
import { layoutHasVisibleField } from "@/components/forms/quickCreateLayout";
import { QuickCreateSurface, type QuickCreateOutcome } from "@/components/ui/QuickCreateSurface";
import {
  useQuickCreateRecord,
  type QuickCreateContext,
} from "@/hooks/useQuickCreateRecord";
import { RecordLayoutContractError } from "@/hooks/useResolvedRecordLayout";

/**
 * The contextual "+ Deal" surface reachable from a Contact or an Account.
 *
 * This is deliberately not wired into the Deals list: rolling Quick Create and the workspace
 * to Opportunity as a whole depends on the explicit participant model, which is a separate
 * slice. What this surface does is stop the CRM asking for a relationship it already knows.
 * The canonical /dashboard/sales/opportunities/new page remains the complete entry point.
 */

const FULL_CREATE_ROUTE = "/dashboard/sales/opportunities/new";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onCreated?: (opportunityId: number | null) => void;
  /** The record this was opened from. Its ids are prefilled and re-validated server-side. */
  context: QuickCreateContext<OpportunityFormValue>;
};

function layoutErrorMessage(error: unknown) {
  if (error instanceof RecordLayoutContractError && error.status === 403) {
    return "You no longer have permission to create deals. Ask an administrator to restore access.";
  }
  return "The Deal Quick Create layout could not be loaded. Use More details to create this deal on the full form.";
}

function describeSubmitError(error: unknown) {
  if (!(error instanceof OpportunityMutationError)) {
    return { message: "We could not reach the server. Your entries are still here — try again." };
  }
  if (error.detail && (error.status === 400 || error.status === 409)) {
    // "Contact not found" / "Organization not found" mean the prefilled link was rejected.
    return {
      message: error.detail,
      focusFieldKey: error.detail.startsWith("Contact") ? "contact_id" : undefined,
    };
  }
  if (error.status === 403) {
    return {
      message: "You do not have permission to create this deal or link it to that contact or account.",
    };
  }
  return { message: "The deal could not be created. Check the fields and try again." };
}

export function OpportunityQuickCreate({
  open,
  onOpenChange,
  returnFocusRef,
  onCreated,
  context,
}: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const defaults = context.defaults ?? {};
  // Only the relationship the source record actually establishes is locked. A deal opened
  // from an Account still needs its contact chosen, so that field stays editable.
  const lockedFieldKeys = (["contact_id", "organization_id"] as const).filter(
    (key) => defaults[key] != null,
  );

  const quickCreate = useQuickCreateRecord<OpportunityFormValue>({
    moduleKey: "sales_opportunities",
    open,
    emptyForm: EMPTY_OPPORTUNITY_FORM,
    context,
    inputId: opportunityQuickCreateInputId,
    validate: ({ layout, form, customFieldValues }) => {
      const errors = validateOpportunityQuickCreateLayout(layout, form, customFieldValues);
      if (!errors.opportunity_name && layoutHasVisibleField(layout, "opportunity_name")) {
        const nameError = validateOpportunityName(form.opportunity_name);
        if (nameError) errors.opportunity_name = nameError;
      }
      // The domain requires a contact whether or not the layout chose to show the field.
      if (!errors.contact_id) {
        const contactError = validateOpportunityContact(form.contact_id);
        if (contactError) errors.contact_id = contactError;
      }
      return errors;
    },
    save: ({ form, customFieldValues, moduleFields }) =>
      saveOpportunity({
        mode: "create",
        payload: buildOpportunityPayload(form, customFieldValues, moduleFields),
      }),
    onCreated: async (opportunityId, outcome) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-opportunities"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-opportunities-pipeline-summary"] }),
      ]);
      toast.success("Deal created.");
      onCreated?.(opportunityId);
      onOpenChange(false);
      quickCreate.reset();
      if (outcome === "create-and-open" && opportunityId !== null) {
        router.push(`/dashboard/sales/opportunities/${opportunityId}`);
      }
    },
    describeSubmitError,
  });

  const { invalidFieldCount, layout, layoutQuery } = quickCreate;

  return (
    <QuickCreateSurface
      open={open}
      onOpenChange={onOpenChange}
      title="Create deal"
      description={
        context.sourceModuleKey === "sales_organizations"
          ? "This deal will be linked to the account you came from."
          : "This deal will be linked to the contact you came from."
      }
      returnFocusRef={returnFocusRef}
      isDirty={quickCreate.isDirty}
      isPending={quickCreate.isSubmitting}
      isLoading={layoutQuery.isLoading}
      error={quickCreate.submitError ?? (layoutQuery.error ? layoutErrorMessage(layoutQuery.error) : null)}
      validationSummary={
        invalidFieldCount
          ? `Complete ${invalidFieldCount} required ${invalidFieldCount === 1 ? "field" : "fields"} to create this deal.`
          : null
      }
      statusMessage={quickCreate.isDirty ? "Unsaved changes" : "Ready to create"}
      onSubmit={(outcome: QuickCreateOutcome) => quickCreate.handleSubmit(outcome)}
      // The full deal form has campaign, delivery, and forecasting sections a quick surface
      // should not carry. Handing entered values across it is Wave 2D's job, so this sends the
      // user to a clean canonical form rather than pretending the values travelled.
      onMoreDetails={() => {
        onOpenChange(false);
        router.push(FULL_CREATE_ROUTE);
      }}
      moreDetailsLabel="Full deal form"
      discardTitle="Discard this deal?"
      discardDescription="The details you entered here have not been saved."
    >
      {layout ? (
        <OpportunityQuickCreateLayoutFields
          layout={layout}
          value={quickCreate.form}
          onChange={quickCreate.setForm}
          customValues={quickCreate.customFieldValues}
          onCustomChange={quickCreate.setCustomFieldValue}
          errors={quickCreate.errors}
          lockedFieldKeys={lockedFieldKeys}
          contactOrganizationFilter={
            context.sourceModuleKey === "sales_organizations"
              ? (defaults.organization_id as number | null | undefined) ?? null
              : null
          }
        />
      ) : null}
    </QuickCreateSurface>
  );
}
