"use client";

import { type RefObject } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { EMPTY_CONTACT_FORM, type ContactFormValue } from "@/components/contacts/ContactFormFields";
import {
  ContactQuickCreateLayoutFields,
  contactQuickCreateInputId,
  validateContactQuickCreateLayout,
} from "@/components/contacts/ContactQuickCreateLayoutFields";
import {
  ContactMutationError,
  buildContactPayload,
  saveContact,
  validateContactEmail,
} from "@/components/contacts/contactMutation";
import {
  CONTACT_QUICK_CREATE_HANDOFF_ROUTE,
  saveContactQuickCreateDraft,
} from "@/components/contacts/contactQuickCreateDraft";
import { layoutHasVisibleField } from "@/components/forms/quickCreateLayout";
import { QuickCreateSurface, type QuickCreateOutcome } from "@/components/ui/QuickCreateSurface";
import {
  useQuickCreateRecord,
  type QuickCreateContext,
} from "@/hooks/useQuickCreateRecord";
import { RecordLayoutContractError } from "@/hooks/useResolvedRecordLayout";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Focus returns here when the surface closes. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** Called after a successful create so the caller can refresh in place. */
  onCreated: (contactId: number | null) => void;
  /**
   * Set when opened from another record (Organization -> + Contact). The account is
   * prefilled and shown read-only; the server re-checks tenant ownership and link permission.
   */
  context?: QuickCreateContext<ContactFormValue>;
};

function layoutErrorMessage(error: unknown) {
  if (error instanceof RecordLayoutContractError && error.status === 403) {
    return "You no longer have permission to create contacts. Ask an administrator to restore access.";
  }
  if (error instanceof RecordLayoutContractError && error.kind === "malformed_response") {
    return "The Contact Quick Create layout could not be read. Use More details to create this contact on the full form.";
  }
  return "The Contact Quick Create layout could not be loaded. Use More details to create this contact on the full form.";
}

function describeSubmitError(error: unknown) {
  if (!(error instanceof ContactMutationError)) {
    return { message: "We could not reach the server. Your entries are still here — try again." };
  }
  // 400/409 carry a specific domain reason: a duplicate contact, or a rejected account or owner.
  if (error.detail && (error.status === 400 || error.status === 409)) {
    return {
      message: error.detail,
      focusFieldKey: error.status === 409 ? "primary_email" : undefined,
    };
  }
  if (error.status === 403) {
    return {
      message: "You do not have permission to create this contact or link it to that account.",
    };
  }
  return { message: "The contact could not be created. Check the fields and try again." };
}

export function ContactQuickCreate({ open, onOpenChange, returnFocusRef, onCreated, context }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const lockedFieldKeys = Object.keys(context?.defaults ?? {}).filter(
    (key) => key === "organization_id",
  );

  const quickCreate = useQuickCreateRecord<ContactFormValue>({
    moduleKey: "sales_contacts",
    open,
    emptyForm: EMPTY_CONTACT_FORM,
    context,
    inputId: contactQuickCreateInputId,
    validate: ({ layout, form, customFieldValues }) => {
      const errors = validateContactQuickCreateLayout(layout, form, customFieldValues);
      if (!errors.primary_email && layoutHasVisibleField(layout, "primary_email")) {
        const emailError = validateContactEmail(form.primary_email);
        if (emailError) errors.primary_email = emailError;
      }
      return errors;
    },
    save: ({ form, customFieldValues, moduleFields }) =>
      saveContact({
        mode: "create",
        payload: buildContactPayload(form, customFieldValues, moduleFields),
      }),
    onCreated: async (contactId, outcome) => {
      await queryClient.invalidateQueries({ queryKey: ["sales-contacts"] });
      toast.success("Contact created.");
      onCreated(contactId);
      // Closing directly rather than through the dirty guard: the entered data was saved.
      onOpenChange(false);
      quickCreate.reset();
      if (outcome === "create-and-open" && contactId !== null) {
        router.push(`/dashboard/sales/contacts/${contactId}`);
      }
    },
    describeSubmitError,
  });

  function handleMoreDetails() {
    saveContactQuickCreateDraft({
      form: quickCreate.form,
      customFieldValues: quickCreate.customFieldValues,
    });
    onOpenChange(false);
    quickCreate.reset();
    router.push(CONTACT_QUICK_CREATE_HANDOFF_ROUTE);
  }

  const { invalidFieldCount, layout, layoutQuery } = quickCreate;

  return (
    <QuickCreateSurface
      open={open}
      onOpenChange={onOpenChange}
      title="Create contact"
      description={
        context?.sourceModuleKey === "sales_organizations"
          ? "This contact will be linked to the account you came from."
          : "Capture the essentials now. The full form stays available under More details."
      }
      returnFocusRef={returnFocusRef}
      isDirty={quickCreate.isDirty}
      isPending={quickCreate.isSubmitting}
      isLoading={layoutQuery.isLoading}
      error={quickCreate.submitError ?? (layoutQuery.error ? layoutErrorMessage(layoutQuery.error) : null)}
      validationSummary={
        invalidFieldCount
          ? `Complete ${invalidFieldCount} required ${invalidFieldCount === 1 ? "field" : "fields"} to create this contact.`
          : null
      }
      statusMessage={quickCreate.isDirty ? "Unsaved changes" : "Ready to create"}
      onSubmit={(outcome: QuickCreateOutcome) => quickCreate.handleSubmit(outcome)}
      onMoreDetails={handleMoreDetails}
      discardTitle="Discard this contact?"
      discardDescription="The details you entered here have not been saved."
    >
      {layout ? (
        <ContactQuickCreateLayoutFields
          layout={layout}
          value={quickCreate.form}
          onChange={quickCreate.setForm}
          customValues={quickCreate.customFieldValues}
          onCustomChange={quickCreate.setCustomFieldValue}
          errors={quickCreate.errors}
          lockedFieldKeys={lockedFieldKeys}
        />
      ) : null}
    </QuickCreateSurface>
  );
}
