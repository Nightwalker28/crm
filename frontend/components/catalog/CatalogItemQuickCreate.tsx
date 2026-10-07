"use client";

import { useRef, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  buildCatalogPayload,
  EMPTY_CATALOG_FORM,
  optionalDecimal,
  type CatalogFormState,
} from "@/components/catalog/catalogForm";
import { makeQuickCreateInputId, validateLayoutDrivenQuickCreate } from "@/components/forms/quickCreateLayout";
import { RecordForm } from "@/components/forms/RecordForm";
import { QuickCreateSurface, type QuickCreateOutcome } from "@/components/ui/QuickCreateSurface";
import { useCatalogRecordActions, type CatalogKind, type CatalogRecord } from "@/hooks/catalog/useCatalogRecords";
import { useBaseCurrency } from "@/hooks/useCompanyCurrencies";
import { useQuickCreateRecord, type QuickCreateContext } from "@/hooks/useQuickCreateRecord";
import { RecordLayoutContractError } from "@/hooks/useResolvedRecordLayout";
import { formErrorMessage } from "@/lib/apiErrors";
import { createQuickCreateDraftStore } from "@/lib/quickCreateDraft";

/** One draft store per kind: *More details* hands the entered values to the full form. */
export const catalogQuickCreateDrafts: Record<CatalogKind, ReturnType<typeof createQuickCreateDraftStore<CatalogFormState>>> = {
  products: createQuickCreateDraftStore<CatalogFormState>({
    storageKey: "lynk:product-quick-create-draft",
    fullCreateRoute: "/dashboard/catalog/products/new",
    emptyForm: EMPTY_CATALOG_FORM,
  }),
  services: createQuickCreateDraftStore<CatalogFormState>({
    storageKey: "lynk:service-quick-create-draft",
    fullCreateRoute: "/dashboard/catalog/services/new",
    emptyForm: EMPTY_CATALOG_FORM,
  }),
};

type Props = {
  kind: CatalogKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** The saved record, so a line editor can fill its line from it. */
  onCreated?: (record: CatalogRecord) => void;
  /** Prefilled values: a line's typed name and the document's currency; a PO's vendor. */
  context?: QuickCreateContext<CatalogFormState>;
  /**
   * Opened from inside another form (a line's *Create "…"*): no *More details* or
   * *Create & open*, which would leave that form's unsaved work.
   */
  embedded?: boolean;
};

/**
 * Product and service quick create (13b Phase 5, F3.7): the catalog list's *Create*, and a
 * line editor's *Create product "…"*. The layout is the module's `quick_create`; the payload
 * is the full form's (`buildCatalogPayload`), so the two cannot disagree.
 */
export function CatalogItemQuickCreate({ kind, open, onOpenChange, returnFocusRef, onCreated, context, embedded = false }: Props) {
  const router = useRouter();
  const isProduct = kind === "products";
  const noun = isProduct ? "product" : "service";
  const moduleKey = isProduct ? "catalog_products" : "catalog_services";
  const inputId = makeQuickCreateInputId(`${noun}-quick-create`, moduleKey);
  const actions = useCatalogRecordActions(kind);
  const baseCurrency = useBaseCurrency();
  // The hook reports an id; the line editor needs the whole record (its price and currency).
  const savedRecord = useRef<CatalogRecord | null>(null);

  const quickCreate = useQuickCreateRecord<CatalogFormState>({
    moduleKey,
    open,
    emptyForm: EMPTY_CATALOG_FORM,
    context,
    inputId,
    validate: ({ layout, form, customFieldValues }) => {
      const errors = validateLayoutDrivenQuickCreate(layout, form, customFieldValues);
      if (!errors.name && !form.name.trim()) errors.name = "Name is required.";
      if (!errors.list_price && optionalDecimal(form.list_price) === null) errors.list_price = "List price must be blank or zero or greater.";
      return errors;
    },
    save: async ({ form, customFieldValues }) => {
      const payload = buildCatalogPayload(form, customFieldValues, {
        isProduct,
        currency: form.currency || baseCurrency.data || "USD",
      });
      if (!payload) throw new Error("Check the numbers: each must be zero or more.");
      const record = await actions.createRecord(payload);
      savedRecord.current = record;
      return record.id;
    },
    onCreated: async (recordId, outcome) => {
      toast.success(`${isProduct ? "Product" : "Service"} created.`);
      if (savedRecord.current) onCreated?.(savedRecord.current);
      onOpenChange(false);
      quickCreate.reset();
      if (outcome === "create-and-open" && recordId !== null) router.push(`/dashboard/catalog/${kind}/${recordId}`);
    },
    describeSubmitError: (error) => ({
      message: formErrorMessage(error, `The ${noun} could not be created. Check the fields and try again.`),
    }),
  });

  function handleMoreDetails() {
    const store = catalogQuickCreateDrafts[kind];
    store.save({ form: quickCreate.form, customFieldValues: quickCreate.customFieldValues });
    onOpenChange(false);
    quickCreate.reset();
    router.push(store.handoffRoute);
  }

  const { invalidFieldCount, layout, layoutQuery } = quickCreate;
  const layoutError = layoutQuery.error
    ? layoutQuery.error instanceof RecordLayoutContractError && layoutQuery.error.status === 403
      ? `You no longer have permission to create ${noun}s. Ask an administrator to restore access.`
      : `The ${isProduct ? "Product" : "Service"} Quick Create layout could not be loaded.${embedded ? "" : ` Use More details to create this ${noun} on the full form.`}`
    : null;

  return (
    <QuickCreateSurface
      open={open}
      onOpenChange={onOpenChange}
      title={`Create ${noun}`}
      description={
        embedded
          ? `The new ${noun} goes on this line. Open it later to add stock, pictures and website details.`
          : "Capture the essentials now. The full form stays available under More details."
      }
      returnFocusRef={returnFocusRef}
      isDirty={quickCreate.isDirty}
      isPending={quickCreate.isSubmitting}
      isLoading={layoutQuery.isLoading}
      error={quickCreate.submitError ?? layoutError}
      validationSummary={
        invalidFieldCount
          ? `Complete ${invalidFieldCount} required ${invalidFieldCount === 1 ? "field" : "fields"} to create this ${noun}.`
          : null
      }
      statusMessage={quickCreate.isDirty ? "Unsaved changes" : "Ready to create"}
      onSubmit={(outcome: QuickCreateOutcome) => quickCreate.handleSubmit(outcome)}
      onMoreDetails={embedded ? undefined : handleMoreDetails}
      showCreateAndOpen={!embedded}
      discardTitle={`Discard this ${noun}?`}
      discardDescription="The details you entered here have not been saved."
    >
      {layout ? (
        <RecordForm
          moduleKey={moduleKey}
          layout={layout}
          value={quickCreate.form}
          onChange={quickCreate.setForm}
          customValues={quickCreate.customFieldValues}
          onCustomChange={quickCreate.setCustomFieldValue}
          inputId={inputId}
          errors={quickCreate.errors}
        />
      ) : null}
    </QuickCreateSurface>
  );
}
