"use client";

import { formatSnakeCaseLabel } from "@/lib/module-display";
import { MediaImage } from "@/components/ui/MediaImage";
import Link from "next/link";
import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";

import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import { FormErrorBanner } from "@/components/forms/FormErrorBanner";
import { LayoutRecordFormBody } from "@/components/forms/LayoutRecordFormBody";
import type { RecordFormFieldContext } from "@/components/forms/RecordForm";
import { QuickCreateField, validateLayoutDrivenQuickCreate } from "@/components/forms/quickCreateLayout";
import { FormSection, RecordFormLayout } from "@/components/forms/RecordFormLayout";
import { useRecordTabHref } from "@/components/recordWorkspace/RecordWorkspace";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { RouteErrorState, RouteLoadingState } from "@/components/ui/RouteStates";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CatalogKind, CatalogRecord } from "@/hooks/catalog/useCatalogRecords";
import { useCatalogRecord, useCatalogRecordActions } from "@/hooks/catalog/useCatalogRecords";
import { useResolvedRecordLayout, type ResolvedRecordLayoutField } from "@/hooks/useResolvedRecordLayout";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { useBaseCurrency } from "@/hooks/useCompanyCurrencies";
import { useCloneDraft } from "@/hooks/useCloneDraft";
import { formatDateTime } from "@/lib/datetime";
import { resolveMediaUrl } from "@/lib/media";
import { CatalogGallery } from "@/components/catalog/CatalogGallery";
import { catalogQuickCreateDrafts } from "@/components/catalog/CatalogItemQuickCreate";
import {
  buildCatalogPayload,
  catalogFormSeed,
  DIMENSION_UNITS,
  optionalDecimal,
  requiredDecimal,
  WEIGHT_UNITS,
  type CatalogFormState,
} from "@/components/catalog/catalogForm";

/** The ids these inputs had before the layout drew them; specs and focus still use them. */
const CATALOG_INPUT_IDS: Record<string, string> = {
  public_unit_price: "catalog-price",
  cost_price: "catalog-cost",
};

export function catalogInputId(fieldKey: string) {
  return CATALOG_INPUT_IDS[fieldKey] ?? `catalog-${fieldKey.replace(/_/g, "-")}`;
}

export default function CatalogRecordFormPage({
  kind,
  mode = "create",
  recordId,
}: {
  kind: CatalogKind;
  mode?: "create" | "edit";
  recordId?: number;
}) {
  const query = useCatalogRecord(kind, mode === "edit" ? recordId ?? null : null);
  // *Clone* (13b Phase 5): `?clone=<id>` opens this create form filled from that record.
  const clone = useCloneDraft(kind === "products" ? "catalog_products" : "catalog_services", mode === "create");
  const noun = kind === "products" ? "product" : "service";
  if ((mode === "edit" && query.isLoading) || clone.isLoading) return <RouteLoadingState label={noun} />;
  if ((mode === "edit" && (query.error || !query.data)) || clone.error) {
    return (
      <RouteErrorState
        title={clone.error ? `This ${noun} could not be copied` : `${formatSnakeCaseLabel(noun)} could not be loaded`}
        reset={() => void (clone.error ? clone.refetch() : query.refetch())}
        backHref={`/dashboard/catalog/${kind}`}
        backLabel={`Back to ${kind}`}
      />
    );
  }
  const draftFields = clone.draft?.fields as Partial<CatalogRecord> | undefined;
  return (
    <CatalogRecordFormEditor
      key={`${kind}:${mode}:${recordId ?? "new"}:${query.data?.updated_at ?? ""}:${clone.cloneId ?? ""}`}
      kind={kind}
      mode={mode}
      recordId={recordId}
      record={query.data}
      seed={catalogFormSeed(query.data ?? draftFields)}
      seedCustomValues={query.data?.custom_fields ?? clone.draft?.custom_fields ?? {}}
    />
  );
}

function CatalogRecordFormEditor({
  kind,
  mode,
  recordId,
  record,
  seed,
  seedCustomValues,
}: {
  kind: CatalogKind;
  mode: "create" | "edit";
  recordId?: number;
  record?: CatalogRecord;
  seed: CatalogFormState;
  seedCustomValues: Record<string, unknown>;
}) {
  const router = useRouter();
  const actions = useCatalogRecordActions(kind);
  const isProduct = kind === "products";
  const moduleKey = isProduct ? "catalog_products" : "catalog_services";
  const [form, setForm] = useState(seed);
  const [customValues, setCustomValues] = useState<Record<string, unknown>>(seedCustomValues);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [initialSnapshot] = useState(() => JSON.stringify([seed, seedCustomValues, null]));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [stockError, setStockError] = useState<string | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState(false);
  // The `full_form` layout (13b Phase 4e); the body below reads the same cached query.
  const layoutQuery = useResolvedRecordLayout(moduleKey, "full_form");
  // A tracked product's cost is its moving average, changed by Revalue (12d §5 decision 3).
  const costIsAverage = isProduct && mode === "edit" && Boolean(record?.track_inventory);
  const baseCurrency = useBaseCurrency();
  const currency = form.currency || baseCurrency.data || "USD";
  const noun = isProduct ? "product" : "service";
  const titleNoun = isProduct ? "Product" : "Service";
  const listHref = `/dashboard/catalog/${kind}`;
  // R2 travels in both directions: the tab the operator left is on this page's own URL, so
  // Back, Cancel and the post-save redirect all return to it.
  const detailHref = useRecordTabHref(recordId ? `${listHref}/${recordId}` : listHref);
  const snapshot = useMemo(
    () => JSON.stringify([form, customValues, mediaFile ? [mediaFile.name, mediaFile.size, mediaFile.lastModified] : null]),
    [form, customValues, mediaFile],
  );
  const dirty = snapshot !== initialSnapshot;

  useUnsavedChangesGuard(dirty, actions.isSaving);

  // Picks up values handed off from Quick Create's "More details". The initial snapshot stays
  // the empty form, so the restored values count as unsaved changes and stay guarded.
  useEffect(() => {
    const store = catalogQuickCreateDrafts[kind];
    if (mode !== "create" || !store.isHandoff(window.location.search)) return;
    const draft = store.consume();
    if (!draft) return;
    // sessionStorage exists only after hydration, so the handoff cannot seed the first render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm(draft.form);
    setCustomValues(draft.customFieldValues);
  }, [kind, mode]);

  function validate() {
    const nextErrors = layoutQuery.data ? validateLayoutDrivenQuickCreate(layoutQuery.data, form, customValues) : {};
    const fieldError = (key: string, message: string | null) => {
      if (message && !nextErrors[key]) nextErrors[key] = message;
    };
    fieldError("name", form.name.trim() ? null : "Name is required.");
    fieldError("unit", form.unit ? null : "Choose the unit this is sold in.");
    fieldError("public_unit_price", requiredDecimal(form.public_unit_price) == null ? "Website price must be zero or greater." : null);
    fieldError("list_price", optionalDecimal(form.list_price) === null ? "List price must be blank or zero or greater." : null);
    fieldError("cost_price", !costIsAverage && optionalDecimal(form.cost_price) === null ? "Cost must be blank or zero or greater." : null);
    if (isProduct) {
      for (const key of ["weight", "length", "width", "height"]) {
        fieldError(key, optionalDecimal(String(form[key] ?? "")) === null ? "Enter zero or more, or leave it blank." : null);
      }
    }
    const nextStockError = isProduct && optionalDecimal(form.stock_quantity) === null
      ? "Stock quantity must be blank or zero or greater."
      : null;
    const nextReorderError = isProduct && (requiredDecimal(form.reorder_point) === null || requiredDecimal(form.reorder_quantity) === null) ? "Reorder values must be zero or greater." : null;
    setFieldErrors(nextErrors);
    setStockError(nextStockError);
    setReorderError(nextReorderError);
    const firstInvalid = Object.keys(nextErrors)[0];
    if (firstInvalid) {
      document.getElementById(
        firstInvalid.startsWith("custom:")
          ? `custom-field-${moduleKey}-${firstInvalid.slice("custom:".length)}`
          : catalogInputId(firstInvalid),
      )?.focus();
    } else if (nextStockError) document.getElementById("catalog-stock-quantity")?.focus();
    else if (nextReorderError) document.getElementById("catalog-reorder-point")?.focus();
    return !firstInvalid && !nextStockError && !nextReorderError;
  }

  async function submit() {
    if (!validate() || actions.isSaving) return;
    const payload = buildCatalogPayload(form, customValues, {
      isProduct,
      currency,
      costIsAverage,
      stockIsTracked: mode === "edit" && Boolean(record?.track_inventory),
    });
    if (!payload) return;

    try {
      setSubmitError(false);
      const saved = mode === "edit" && recordId
        ? await actions.updateRecord(recordId, payload)
        : await actions.createRecord(payload);
      if (mediaFile) {
        try {
          await actions.uploadMedia(saved.id, mediaFile);
        } catch {
          toast.error(`${titleNoun} saved, but the image could not be uploaded. You can retry from Edit.`);
        }
      }
      toast.success(`${titleNoun} ${mode === "edit" ? "updated" : "created"}.`);
      router.push(mode === "edit" ? detailHref : `${listHref}/${saved.id}`);
    } catch {
      setSubmitError(true);
    }
  }

  /** The catalog's own controls: the two unit lists, and the cost a tracked product averages. */
  function renderField(field: ResolvedRecordLayoutField, context: RecordFormFieldContext) {
    const { inputId, aria, error, disabled, set } = context;
    const frame = (control: ReactNode) => (
      <QuickCreateField field={field} aria={aria} error={error}>{control}</QuickCreateField>
    );
    if (field.field_key === "weight_unit" || field.field_key === "dimension_unit") {
      const units = field.field_key === "weight_unit" ? WEIGHT_UNITS : DIMENSION_UNITS;
      return frame(
        <Select value={String(form[field.field_key] ?? "")} onValueChange={(next) => set({ [field.field_key]: next })} disabled={disabled}>
          <SelectTrigger id={inputId} aria-invalid={aria.invalid || undefined} aria-describedby={aria.describedBy}><SelectValue /></SelectTrigger>
          <SelectContent>
            {units.map((unit) => <SelectItem key={unit.value} value={unit.value}>{unit.label}</SelectItem>)}
          </SelectContent>
        </Select>,
      );
    }
    if (field.field_key === "cost_price") {
      const descriptionId = `${inputId}-description`;
      return (
        <Field data-invalid={Boolean(error)}>
          <FieldLabel htmlFor={inputId}>{costIsAverage ? "Average cost" : field.label}</FieldLabel>
          <Input
            id={inputId}
            value={form.cost_price}
            readOnly={costIsAverage}
            disabled={disabled}
            inputMode="decimal"
            onChange={(event) => set({ cost_price: event.target.value })}
            aria-invalid={aria.invalid || undefined}
            aria-describedby={[descriptionId, aria.errorId].filter(Boolean).join(" ")}
          />
          <FieldDescription id={descriptionId}>
            {costIsAverage
              ? `The average cost of the stock on hand, in ${baseCurrency.data ?? "the base currency"}. Change it with Revalue on the Stock tab.`
              : `What one ${form.unit || "unit"} costs you, in ${baseCurrency.data ?? "the base currency"}${isProduct && form.track_inventory ? "; the starting average cost once stock arrives" : ""}. Internal only: never shown to customers.`}
          </FieldDescription>
          {error ? <FieldError id={aria.errorId}>{error}</FieldError> : null}
        </Field>
      );
    }
    return undefined;
  }

  return (
    <PageShell
      eyebrow={mode === "edit" && record?.updated_at ? `Last modified ${formatDateTime(record.updated_at)}` : undefined}
      title={mode === "edit" ? `Edit ${record?.name ?? noun}` : `Create ${noun}`}
      description={mode === "edit" ? `Update this ${noun}'s catalog, pricing, visibility, and media details.` : `Add a ${noun} with customer-facing pricing, visibility, and media.`}
      actions={<Button asChild variant="ghost" size="sm"><Link href={mode === "edit" ? detailHref : listHref}><ArrowLeft />Back to {mode === "edit" ? noun : kind}</Link></Button>}
    >
      {submitError ? (
        <FormErrorBanner title={`We could not ${mode === "edit" ? "update" : "create"} this ${noun}.`}>Check the entered information and try again.</FormErrorBanner>
      ) : null}

      <RecordFormLayout
        title={mode === "edit" ? (record?.name ?? titleNoun) : `New ${noun}`}
        status={dirty ? "Unsaved changes" : mode === "edit" ? null : `Complete the required fields to create this ${noun}.`}
        actions={(
          <>
            <Button asChild variant="outline"><Link href={mode === "edit" ? detailHref : listHref}>Cancel</Link></Button>
            <Button onClick={() => void submit()} disabled={actions.isSaving || (mode === "edit" && !dirty)}><Save />{actions.isSaving ? "Saving…" : mode === "edit" ? "Save changes" : `Create ${noun}`}</Button>
          </>
        )}
      >
        <LayoutRecordFormBody<CatalogFormState>
          moduleKey={moduleKey}
          value={form}
          onChange={setForm}
          customValues={customValues}
          onCustomChange={(key, value) => setCustomValues((current) => ({ ...current, [key]: value }))}
          inputId={catalogInputId}
          action={mode}
          errors={fieldErrors}
          renderField={renderField}
          slots={{
            // Stock and purchasing are the product's inventory, not header fields: last.
            mainInsert: isProduct ? {
              afterSection: "website",
              node: (
                <CatalogInventorySections
                  form={form}
                  setForm={setForm}
                  record={record}
                  mode={mode}
                  stockError={stockError}
                  reorderError={reorderError}
                  onClearStockError={() => setStockError(null)}
                  onClearReorderError={() => setReorderError(null)}
                />
              ),
            } : undefined,
            fixedSidebar: (
              <div className="grid gap-6">
                <Card className="p-6">
                  <SectionHeading description="Control availability inside Lynk and the public website feed.">Publishing</SectionHeading>
                  <div className="mt-4 grid gap-3">
                    <ToggleRow label="Public website feed" checked={form.is_public} onChange={(is_public) => setForm((current) => ({ ...current, is_public }))} />
                    <ToggleRow label="Active" checked={form.is_active} onChange={(is_active) => setForm((current) => ({ ...current, is_active }))} />
                  </div>
                </Card>
                <Card className="p-6">
                  <SectionHeading description="Upload a customer-facing image for this catalog record.">Media</SectionHeading>
                  <div className="mt-4 grid gap-3">
                    <MediaImage
                      src={resolveMediaUrl(record?.media_url)}
                      alt=""
                      width={320}
                      height={240}
                      className="aspect-[4/3] w-full rounded-[var(--radius-control)] object-cover"
                      fallback={<div className="flex aspect-[4/3] items-center justify-center rounded-[var(--radius-control)] border border-dashed border-line-strong text-sm text-copy-muted">No media uploaded</div>}
                    />
                    <Field>
                      <FieldLabel htmlFor="catalog-media">Image</FieldLabel>
                      <Input id="catalog-media" type="file" accept="image/*" onChange={(event) => setMediaFile(event.target.files?.[0] ?? null)} />
                      {mediaFile ? <FieldDescription>{mediaFile.name}</FieldDescription> : null}
                    </Field>
                    <CatalogGallery kind={kind} recordId={mode === "edit" ? recordId : undefined} initialImages={record?.images ?? []} />
                  </div>
                </Card>
              </div>
            ),
          }}
        />
      </RecordFormLayout>
    </PageShell>
  );
}

/** Inventory and purchasing: fixed sections of a product's form, under the layout's fields. */
function CatalogInventorySections({
  form,
  setForm,
  record,
  mode,
  stockError,
  reorderError,
  onClearStockError,
  onClearReorderError,
}: {
  form: CatalogFormState;
  setForm: Dispatch<SetStateAction<CatalogFormState>>;
  record?: CatalogRecord;
  mode: "create" | "edit";
  stockError: string | null;
  reorderError: string | null;
  onClearStockError: () => void;
  onClearReorderError: () => void;
}) {
  return (
    <>
          <FormSection title="Inventory" description="Tracked stock changes through audited movements. Untracked availability stays a manual status.">
            <FieldGroup columns={2}>
              <Field className="md:col-span-2">
                <label className="flex items-center gap-2 text-sm text-copy-secondary">
                  <Checkbox checked={form.track_inventory} disabled={Boolean(record?.track_inventory)} onCheckedChange={(value) => setForm((current) => ({ ...current, track_inventory: value === true }))} />
                  Track inventory
                </label>
                <FieldDescription>Tracked products use stock movements and cannot be switched back to manual stock.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel>Status</FieldLabel>
                {form.track_inventory ? <p className="text-sm text-copy-secondary">Derived from on hand quantity</p> : <Select value={form.stock_status} onValueChange={(stock_status) => setForm((current) => ({ ...current, stock_status }))}>
                  <SelectTrigger aria-label="Stock status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="untracked">Untracked</SelectItem>
                    <SelectItem value="in_stock">In stock</SelectItem>
                    <SelectItem value="out_of_stock">Out of stock</SelectItem>
                    <SelectItem value="preorder">Preorder</SelectItem>
                  </SelectContent>
                </Select>}
              </Field>
              <Field>
                <FieldLabel htmlFor="catalog-stock-quantity">{mode === "edit" && record?.track_inventory ? "On hand" : "Opening quantity"}</FieldLabel>
                <Input id="catalog-stock-quantity" value={form.track_inventory ? form.stock_quantity : ""} disabled={!form.track_inventory || Boolean(record?.track_inventory)} inputMode="decimal" onChange={(event) => { setForm((current) => ({ ...current, stock_quantity: event.target.value })); if (stockError) onClearStockError(); }} aria-invalid={Boolean(stockError)} aria-describedby={stockError ? "catalog-stock-error" : undefined} placeholder="0" />
                {stockError ? <FieldError id="catalog-stock-error">{stockError}</FieldError> : null}
                {mode === "edit" && record?.track_inventory ? <FieldDescription>Use Adjust stock on the product record to change this balance.</FieldDescription> : null}
              </Field>
              {form.track_inventory ? <><Field><FieldLabel htmlFor="catalog-reorder-point">Reorder point</FieldLabel><Input id="catalog-reorder-point" type="number" min="0" step="0.0001" value={form.reorder_point} onChange={(event) => { setForm((current) => ({ ...current, reorder_point: event.target.value })); onClearReorderError(); }} aria-invalid={Boolean(reorderError)} aria-describedby={reorderError ? "catalog-reorder-error" : undefined} /><FieldDescription>Alert when available stock reaches this quantity. Zero turns alerts off.</FieldDescription>{reorderError ? <FieldError id="catalog-reorder-error">{reorderError}</FieldError> : null}</Field><Field><FieldLabel htmlFor="catalog-reorder-quantity">Reorder quantity</FieldLabel><Input id="catalog-reorder-quantity" type="number" min="0" step="0.0001" value={form.reorder_quantity} onChange={(event) => { setForm((current) => ({ ...current, reorder_quantity: event.target.value })); onClearReorderError(); }} /></Field></> : null}
            </FieldGroup>
          </FormSection>

        {form.track_inventory ? (
          <FormSection title="Purchasing" description="Who you buy this from. The Reorder screen groups suggestions by preferred vendor.">
            <FieldGroup columns={2}>
              <Field className="md:col-span-2">
                <FieldLabel htmlFor="catalog-preferred-vendor">Preferred vendor</FieldLabel>
                <LinkedRecordPicker
                  inputId="catalog-preferred-vendor"
                  recordType="vendor"
                  valueId={form.preferred_vendor_id}
                  displayValue={form.preferred_vendor_name}
                  onDisplayValueChange={(value) => setForm((current) => ({ ...current, preferred_vendor_name: value, preferred_vendor_id: null }))}
                  onSelect={(option) => setForm((current) => ({ ...current, preferred_vendor_id: option.id, preferred_vendor_name: option.label }))}
                  onClear={() => setForm((current) => ({ ...current, preferred_vendor_id: null, preferred_vendor_name: "" }))}
                  placeholder="Search vendors"
                />
                <FieldDescription>Only Accounts marked as vendors are offered.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="catalog-vendor-sku">Vendor SKU</FieldLabel>
                <Input id="catalog-vendor-sku" value={form.vendor_sku} maxLength={100} onChange={(event) => setForm((current) => ({ ...current, vendor_sku: event.target.value }))} />
              </Field>
              <Field>
                <FieldLabel htmlFor="catalog-lead-time">Lead time (days)</FieldLabel>
                <Input id="catalog-lead-time" type="number" min="0" step="1" inputMode="numeric" value={form.lead_time_days} onChange={(event) => setForm((current) => ({ ...current, lead_time_days: event.target.value }))} />
              </Field>
            </FieldGroup>
          </FormSection>
        ) : null}
    </>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-3 py-3 text-sm text-copy-secondary">
      <span>{label}</span>
      <Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} />
    </label>
  );
}
