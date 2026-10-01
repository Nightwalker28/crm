"use client";

import { type RefObject } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { layoutHasVisibleField } from "@/components/forms/quickCreateLayout";
import {
  EMPTY_ORGANIZATION_FORM,
  type OrganizationFormValue,
} from "@/components/organizations/OrganizationFormFields";
import {
  OrganizationQuickCreateLayoutFields,
  organizationQuickCreateInputId,
  validateOrganizationQuickCreateLayout,
} from "@/components/organizations/OrganizationQuickCreateLayoutFields";
import {
  OrganizationMutationError,
  buildOrganizationPayload,
  saveOrganization,
  validateOrganizationEmail,
  validateOrganizationName,
} from "@/components/organizations/organizationMutation";
import {
  ORGANIZATION_QUICK_CREATE_HANDOFF_ROUTE,
  saveOrganizationQuickCreateDraft,
} from "@/components/organizations/organizationQuickCreateDraft";
import { QuickCreateSurface, type QuickCreateOutcome } from "@/components/ui/QuickCreateSurface";
import { useQuickCreateRecord } from "@/hooks/useQuickCreateRecord";
import { RecordLayoutContractError } from "@/hooks/useResolvedRecordLayout";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onCreated: (organizationId: number | null) => void;
};

function layoutErrorMessage(error: unknown) {
  if (error instanceof RecordLayoutContractError && error.status === 403) {
    return "You no longer have permission to create accounts. Ask an administrator to restore access.";
  }
  if (error instanceof RecordLayoutContractError && error.kind === "malformed_response") {
    return "The Account Quick Create layout could not be read. Use More details to create this account on the full form.";
  }
  return "The Account Quick Create layout could not be loaded. Use More details to create this account on the full form.";
}

function describeSubmitError(error: unknown) {
  if (!(error instanceof OrganizationMutationError)) {
    return { message: "We could not reach the server. Your entries are still here — try again." };
  }
  // 400/409 carry a specific domain reason: a duplicate account name, or a rejected owner.
  if (error.detail && (error.status === 400 || error.status === 409)) {
    return {
      message: error.detail,
      focusFieldKey: error.status === 409 ? "org_name" : undefined,
    };
  }
  if (error.status === 403) {
    return { message: "You do not have permission to create accounts. Ask an administrator to restore access." };
  }
  return { message: "The account could not be created. Check the fields and try again." };
}

export function OrganizationQuickCreate({ open, onOpenChange, returnFocusRef, onCreated }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const quickCreate = useQuickCreateRecord<OrganizationFormValue>({
    moduleKey: "sales_organizations",
    open,
    emptyForm: EMPTY_ORGANIZATION_FORM,
    inputId: organizationQuickCreateInputId,
    validate: ({ layout, form, customFieldValues }) => {
      const errors = validateOrganizationQuickCreateLayout(layout, form, customFieldValues);
      if (!errors.org_name && layoutHasVisibleField(layout, "org_name")) {
        const nameError = validateOrganizationName(form.org_name);
        if (nameError) errors.org_name = nameError;
      }
      if (!errors.primary_email && layoutHasVisibleField(layout, "primary_email")) {
        const emailError = validateOrganizationEmail(form.primary_email);
        if (emailError) errors.primary_email = emailError;
      }
      return errors;
    },
    save: ({ form, customFieldValues, moduleFields }) =>
      saveOrganization({
        mode: "create",
        payload: buildOrganizationPayload(form, customFieldValues, moduleFields),
      }),
    onCreated: async (organizationId, outcome) => {
      await queryClient.invalidateQueries({ queryKey: ["sales-organizations"] });
      toast.success("Account created.");
      onCreated(organizationId);
      onOpenChange(false);
      quickCreate.reset();
      if (outcome === "create-and-open" && organizationId !== null) {
        router.push(`/dashboard/sales/organizations/${organizationId}`);
      }
    },
    describeSubmitError,
  });

  function handleMoreDetails() {
    saveOrganizationQuickCreateDraft({
      form: quickCreate.form,
      customFieldValues: quickCreate.customFieldValues,
    });
    onOpenChange(false);
    quickCreate.reset();
    router.push(ORGANIZATION_QUICK_CREATE_HANDOFF_ROUTE);
  }

  const { invalidFieldCount, layout, layoutQuery } = quickCreate;

  return (
    <QuickCreateSurface
      open={open}
      onOpenChange={onOpenChange}
      title="Create account"
      description="Capture the essentials now. The full form stays available under More details."
      returnFocusRef={returnFocusRef}
      isDirty={quickCreate.isDirty}
      isPending={quickCreate.isSubmitting}
      isLoading={layoutQuery.isLoading}
      error={quickCreate.submitError ?? (layoutQuery.error ? layoutErrorMessage(layoutQuery.error) : null)}
      validationSummary={
        invalidFieldCount
          ? `Complete ${invalidFieldCount} required ${invalidFieldCount === 1 ? "field" : "fields"} to create this account.`
          : null
      }
      statusMessage={quickCreate.isDirty ? "Unsaved changes" : "Ready to create"}
      onSubmit={(outcome: QuickCreateOutcome) => quickCreate.handleSubmit(outcome)}
      onMoreDetails={handleMoreDetails}
      discardTitle="Discard this account?"
      discardDescription="The details you entered here have not been saved."
    >
      {layout ? (
        <OrganizationQuickCreateLayoutFields
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
