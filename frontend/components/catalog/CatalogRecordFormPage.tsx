"use client";

import { formatSnakeCaseLabel } from "@/lib/module-display";
import { MediaImage } from "@/components/ui/MediaImage";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";

import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import { FormErrorBanner } from "@/components/forms/FormErrorBanner";
import { FormSection, RecordFormLayout } from "@/components/forms/RecordFormLayout";
import { useRecordTabHref } from "@/components/recordWorkspace/RecordWorkspace";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { RouteErrorState, RouteLoadingState } from "@/components/ui/RouteStates";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CatalogKind, CatalogRecord, CatalogRecordPayload } from "@/hooks/catalog/useCatalogRecords";
import { useCatalogCategories } from "@/hooks/catalog/useCatalogCategories";
import { useCatalogRecord, useCatalogRecordActions } from "@/hooks/catalog/useCatalogRecords";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { useBaseCurrency } from "@/hooks/useCompanyCurrencies";
import { formatDateTime } from "@/lib/datetime";
import { resolveMediaUrl } from "@/lib/media";
import { PicklistField, PicklistSelect } from "@/components/picklists/PicklistSelect";
import { CatalogGallery } from "@/components/catalog/CatalogGallery";
import { RecordCustomFieldsSection } from "@/components/customFields/RecordCustomFields";

type FormState = {
  custom_fields: Record<string, unknown>;
  name: string;
  slug: string;
  description: string;
  sku: string;
  barcode: string;
  category_id: string;
  unit: string;
  currency: string;
  public_unit_price: string;
  list_price: string;
  tax_category: string;
  cost_price: string;
  weight: string;
  weight_unit: string;
  length: string;
  width: string;
  height: string;
  dimension_unit: string;
  stock_status: string;
  stock_quantity: string;
  reorder_point: string;
  reorder_quantity: string;
  track_inventory: boolean;
  preferred_vendor_id: number | null;
  preferred_vendor_name: string;
  vendor_sku: string;
  lead_time_days: string;
  is_public: boolean;
  is_active: boolean;
};

const NO_CATEGORY = "none";

// The backend's fixed lists (13b §3.5): small enough not to be picklists.
const WEIGHT_UNITS = [
  { value: "kg", label: "Kilograms (kg)" },
  { value: "g", label: "Grams (g)" },
  { value: "lb", label: "Pounds (lb)" },
  { value: "oz", label: "Ounces (oz)" },
];
const DIMENSION_UNITS = [
  { value: "cm", label: "Centimetres (cm)" },
  { value: "m", label: "Metres (m)" },
  { value: "in", label: "Inches (in)" },
];

const EMPTY_FORM: FormState = {
  custom_fields: {},
  name: "",
  slug: "",
  description: "",
  sku: "",
  barcode: "",
  category_id: NO_CATEGORY,
  unit: "unit",
  currency: "USD",
  public_unit_price: "0",
  list_price: "",
  tax_category: "",
  cost_price: "",
  weight: "",
  weight_unit: "kg",
  length: "",
  width: "",
  height: "",
  dimension_unit: "cm",
  stock_status: "untracked",
  stock_quantity: "",
  reorder_point: "0",
  reorder_quantity: "0",
  track_inventory: false,
  preferred_vendor_id: null,
  preferred_vendor_name: "",
  vendor_sku: "",
  lead_time_days: "",
  is_public: false,
  is_active: true,
};

function formSeed(record?: CatalogRecord): FormState {
  if (!record) return EMPTY_FORM;
  return {
    custom_fields: record.custom_fields ?? {},
    name: record.name ?? "",
    slug: record.slug ?? "",
    description: record.description ?? "",
    sku: record.sku ?? "",
    barcode: record.barcode ?? "",
    category_id: record.category_id ? String(record.category_id) : NO_CATEGORY,
    unit: record.unit ?? "unit",
    currency: record.currency ?? "USD",
    public_unit_price: String(record.public_unit_price ?? "0"),
    list_price: record.list_price == null ? "" : String(record.list_price),
    tax_category: record.tax_category ?? "",
    cost_price: record.cost_price == null ? "" : String(record.cost_price),
    weight: record.weight == null ? "" : String(record.weight),
    weight_unit: record.weight_unit ?? "kg",
    length: record.length == null ? "" : String(record.length),
    width: record.width == null ? "" : String(record.width),
    height: record.height == null ? "" : String(record.height),
    dimension_unit: record.dimension_unit ?? "cm",
    stock_status: record.stock_status ?? "untracked",
    stock_quantity: record.stock_quantity == null ? "" : String(record.stock_quantity),
    reorder_point: String(record.reorder_point ?? 0),
    reorder_quantity: String(record.reorder_quantity ?? 0),
    track_inventory: Boolean(record.track_inventory),
    preferred_vendor_id: record.preferred_vendor_id ?? null,
    preferred_vendor_name: record.preferred_vendor_name ?? "",
    vendor_sku: record.vendor_sku ?? "",
    lead_time_days: record.lead_time_days == null ? "" : String(record.lead_time_days),
    is_public: record.is_public,
    is_active: record.is_active,
  };
}

function optionalDecimal(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function requiredDecimal(value: string): number | null {
  const numeric = optionalDecimal(value);
  return numeric === undefined ? null : numeric;
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
  const noun = kind === "products" ? "product" : "service";
  if (mode === "edit" && query.isLoading) return <RouteLoadingState label={noun} />;
  if (mode === "edit" && (query.error || !query.data)) {
    return (
      <RouteErrorState
        title={`${formatSnakeCaseLabel(noun)} could not be loaded`}
        reset={() => void query.refetch()}
        backHref={`/dashboard/catalog/${kind}`}
        backLabel={`Back to ${kind}`}
      />
    );
  }
  return (
    <CatalogRecordFormEditor
      key={`${kind}:${mode}:${recordId ?? "new"}:${query.data?.updated_at ?? ""}`}
      kind={kind}
      mode={mode}
      recordId={recordId}
      record={query.data}
      seed={formSeed(query.data)}
    />
  );
}

function CatalogRecordFormEditor({
  kind,
  mode,
  recordId,
  record,
  seed,
}: {
  kind: CatalogKind;
  mode: "create" | "edit";
  recordId?: number;
  record?: CatalogRecord;
  seed: FormState;
}) {
  const router = useRouter();
  const actions = useCatalogRecordActions(kind);
  const [form, setForm] = useState(seed);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [initialSnapshot] = useState(() => JSON.stringify([seed, null]));
  const [nameError, setNameError] = useState<string | null>(null);
  const [currencyError, setCurrencyError] = useState<string | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [stockError, setStockError] = useState<string | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [costError, setCostError] = useState<string | null>(null);
  const [unitError, setUnitError] = useState<string | null>(null);
  const [listPriceError, setListPriceError] = useState<string | null>(null);
  const [physicalError, setPhysicalError] = useState<string | null>(null);
  const categories = useCatalogCategories();
  const categoryOptions = useMemo(
    () => [
      { value: NO_CATEGORY, label: "No category" },
      ...(categories.data ?? []).map((category) => ({ value: String(category.id), label: category.full_name })),
    ],
    [categories.data],
  );
  const [submitError, setSubmitError] = useState(false);
  const isProduct = kind === "products";
  // A tracked product's cost is its moving average, changed by Revalue (12d §5 decision 3).
  const costIsAverage = isProduct && mode === "edit" && Boolean(record?.track_inventory);
  const baseCurrency = useBaseCurrency();
  const noun = isProduct ? "product" : "service";
  const titleNoun = isProduct ? "Product" : "Service";
  const listHref = `/dashboard/catalog/${kind}`;
  // R2 travels in both directions: the tab the operator left is on this page's own URL, so
  // Back, Cancel and the post-save redirect all return to it.
  const detailHref = useRecordTabHref(recordId ? `${listHref}/${recordId}` : listHref);
  const snapshot = useMemo(
    () => JSON.stringify([form, mediaFile ? [mediaFile.name, mediaFile.size, mediaFile.lastModified] : null]),
    [form, mediaFile],
  );
  const dirty = snapshot !== initialSnapshot;

  useUnsavedChangesGuard(dirty, actions.isSaving);

  function validate() {
    const nextNameError = form.name.trim() ? null : "Name is required.";
    const nextCurrencyError = /^[A-Z]{3}$/.test(form.currency.trim().toUpperCase()) ? null : "Currency must be a 3-letter code.";
    const nextPriceError = requiredDecimal(form.public_unit_price) == null ? "Public unit price must be zero or greater." : null;
    const nextStockError = isProduct && optionalDecimal(form.stock_quantity) === null
      ? "Stock quantity must be blank or zero or greater."
      : null;
    const nextReorderError = isProduct && (requiredDecimal(form.reorder_point) === null || requiredDecimal(form.reorder_quantity) === null) ? "Reorder values must be zero or greater." : null;
    const nextCostError = optionalDecimal(form.cost_price) === null ? "Cost must be blank or zero or greater." : null;
    const nextUnitError = form.unit ? null : "Choose the unit this is sold in.";
    const nextListPriceError = optionalDecimal(form.list_price) === null ? "List price must be blank or zero or greater." : null;
    const nextPhysicalError = isProduct && [form.weight, form.length, form.width, form.height].some((value) => optionalDecimal(value) === null)
      ? "Weight and dimensions must be blank or zero or greater."
      : null;
    setListPriceError(nextListPriceError);
    setPhysicalError(nextPhysicalError);
    setNameError(nextNameError);
    setCurrencyError(nextCurrencyError);
    setPriceError(nextPriceError);
    setStockError(nextStockError);
    setReorderError(nextReorderError);
    setCostError(nextCostError);
    setUnitError(nextUnitError);
    if (nextNameError) document.getElementById("catalog-name")?.focus();
    else if (nextUnitError) document.getElementById("catalog-unit")?.focus();
    else if (nextCurrencyError) document.getElementById("catalog-currency")?.focus();
    else if (nextPriceError) document.getElementById("catalog-price")?.focus();
    else if (nextListPriceError) document.getElementById("catalog-list-price")?.focus();
    else if (nextCostError) document.getElementById("catalog-cost")?.focus();
    else if (nextStockError) document.getElementById("catalog-stock-quantity")?.focus();
    else if (nextReorderError) document.getElementById("catalog-reorder-point")?.focus();
    else if (nextPhysicalError) document.getElementById("catalog-weight")?.focus();
    return !nextNameError && !nextUnitError && !nextCurrencyError && !nextPriceError && !nextListPriceError && !nextCostError && !nextStockError && !nextReorderError && !nextPhysicalError;
  }

  async function submit() {
    if (!validate() || actions.isSaving) return;
    const price = requiredDecimal(form.public_unit_price);
    const stockQuantity = optionalDecimal(form.stock_quantity);
    const cost = optionalDecimal(form.cost_price);
    if (price == null || stockQuantity === null || cost === null || requiredDecimal(form.reorder_point) === null || requiredDecimal(form.reorder_quantity) === null) return;
    const payload: CatalogRecordPayload = {
      name: form.name.trim(),
      slug: form.slug.trim().toLowerCase() || null,
      description: form.description.trim() || null,
      sku: form.sku.trim() || null,
      barcode: isProduct ? form.barcode.trim() || null : undefined,
      category_id: form.category_id === NO_CATEGORY ? null : Number(form.category_id),
      unit: form.unit,
      cost_price: costIsAverage ? undefined : cost ?? null,
      currency: form.currency.trim().toUpperCase(),
      public_unit_price: price,
      // Blank on a new item takes the website price (13a C4).
      list_price: optionalDecimal(form.list_price) ?? null,
      tax_category: form.tax_category || null,
      weight: isProduct ? optionalDecimal(form.weight) ?? null : undefined,
      weight_unit: isProduct ? form.weight_unit : undefined,
      length: isProduct ? optionalDecimal(form.length) ?? null : undefined,
      width: isProduct ? optionalDecimal(form.width) ?? null : undefined,
      height: isProduct ? optionalDecimal(form.height) ?? null : undefined,
      dimension_unit: isProduct ? form.dimension_unit : undefined,
      stock_status: isProduct && !form.track_inventory ? form.stock_status : undefined,
      stock_quantity: isProduct && !(mode === "edit" && record?.track_inventory) && form.track_inventory ? stockQuantity ?? null : undefined,
      track_inventory: isProduct ? form.track_inventory : undefined,
      reorder_point: isProduct ? Number(form.reorder_point) : undefined,
      reorder_quantity: isProduct ? Number(form.reorder_quantity) : undefined,
      preferred_vendor_id: isProduct ? form.preferred_vendor_id : undefined,
      vendor_sku: isProduct ? form.vendor_sku.trim() || null : undefined,
      lead_time_days: isProduct ? (form.lead_time_days.trim() && Number.isInteger(Number(form.lead_time_days)) && Number(form.lead_time_days) >= 0 ? Number(form.lead_time_days) : null) : undefined,
      is_public: form.is_public,
      is_active: form.is_active,
      custom_fields: form.custom_fields,
    };

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
        sidebar={
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
        }
        status={dirty ? "Unsaved changes" : mode === "edit" ? null : `Complete the required fields to create this ${noun}.`}
        actions={(
          <>
            <Button asChild variant="outline"><Link href={mode === "edit" ? detailHref : listHref}>Cancel</Link></Button>
            <Button onClick={() => void submit()} disabled={actions.isSaving || (mode === "edit" && !dirty)}><Save />{actions.isSaving ? "Saving…" : mode === "edit" ? "Save changes" : `Create ${noun}`}</Button>
          </>
        )}
      >
        <FormSection title={`${titleNoun} details`} description="Define how this record is identified and described throughout the catalog.">
          <FieldGroup columns={2}>
            <Field className="md:col-span-2">
              <FieldLabel htmlFor="catalog-name">Name <RequiredMark /></FieldLabel>
              <Input id="catalog-name" value={form.name} maxLength={180} onChange={(event) => { setForm((current) => ({ ...current, name: event.target.value })); if (nameError) setNameError(null); }} aria-invalid={Boolean(nameError)} aria-describedby={nameError ? "catalog-name-error" : undefined} placeholder={isProduct ? "Camera kit" : "Installation service"} />
              {nameError ? <FieldError id="catalog-name-error">{nameError}</FieldError> : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="catalog-sku">SKU</FieldLabel>
              <Input id="catalog-sku" value={form.sku} maxLength={100} onChange={(event) => setForm((current) => ({ ...current, sku: event.target.value }))} placeholder={isProduct ? "CAM-KIT" : "SVC-INSTALL"} />
            </Field>
            {isProduct ? (
              <Field>
                <FieldLabel htmlFor="catalog-barcode">Barcode</FieldLabel>
                <Input id="catalog-barcode" value={form.barcode} maxLength={100} inputMode="numeric" onChange={(event) => setForm((current) => ({ ...current, barcode: event.target.value }))} placeholder="EAN or UPC" />
              </Field>
            ) : null}
            <Field>
              <FieldLabel htmlFor="catalog-category">Category</FieldLabel>
              <SearchableSelect
                id="catalog-category"
                label="Category"
                value={form.category_id}
                options={categoryOptions}
                onValueChange={(category_id) => setForm((current) => ({ ...current, category_id }))}
                emptyMessage="No category matches that search."
              />
              <FieldDescription>
                {categories.data?.length ? "Group items the way your team browses them." : "Administrators add categories under Settings → Catalog categories."}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="catalog-unit">Unit <RequiredMark /></FieldLabel>
              <PicklistSelect id="catalog-unit" listKey="unit" label="Unit" required value={form.unit} onChange={(unit) => { setForm((current) => ({ ...current, unit })); if (unitError) setUnitError(null); }} ariaInvalid={Boolean(unitError)} ariaDescribedBy={unitError ? "catalog-unit-error" : "catalog-unit-description"} />
              {unitError ? <FieldError id="catalog-unit-error">{unitError}</FieldError> : <FieldDescription id="catalog-unit-description">What one of this is. Administrators manage units under Settings → Picklists.</FieldDescription>}
            </Field>
            <Field className={isProduct ? "md:col-span-2" : undefined}>
              <FieldLabel htmlFor="catalog-slug">Public slug</FieldLabel>
              <Input id="catalog-slug" value={form.slug} maxLength={160} onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))} placeholder={isProduct ? "camera-kit" : "installation-service"} />
            </Field>
            <Field className="md:col-span-2">
              <FieldLabel htmlFor="catalog-description">Description</FieldLabel>
              <Textarea id="catalog-description" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} rows={7} />
            </Field>
          </FieldGroup>
        </FormSection>

        <FormSection title="Pricing" description="The list price is what quotes and orders start from; the public price is what the website feed shows.">
          <FieldGroup columns={2}>
            <Field>
              <FieldLabel htmlFor="catalog-list-price">List price</FieldLabel>
              <Input id="catalog-list-price" value={form.list_price} inputMode="decimal" onChange={(event) => { setForm((current) => ({ ...current, list_price: event.target.value })); if (listPriceError) setListPriceError(null); }} aria-invalid={Boolean(listPriceError)} aria-describedby={listPriceError ? "catalog-list-price-error" : "catalog-list-price-description"} />
              {listPriceError ? <FieldError id="catalog-list-price-error">{listPriceError}</FieldError> : <FieldDescription id="catalog-list-price-description">{mode === "create" ? "Blank uses the public unit price." : "New quote and order lines start at this price."}</FieldDescription>}
            </Field>
            <PicklistField id="catalog-tax-category" listKey="tax_category" label="Tax category" value={form.tax_category} onChange={(tax_category) => setForm((current) => ({ ...current, tax_category }))} />
            <Field>
              <FieldLabel htmlFor="catalog-currency">Currency <RequiredMark /></FieldLabel>
              <Input id="catalog-currency" value={form.currency} maxLength={3} onChange={(event) => { setForm((current) => ({ ...current, currency: event.target.value.toUpperCase() })); if (currencyError) setCurrencyError(null); }} aria-invalid={Boolean(currencyError)} aria-describedby={currencyError ? "catalog-currency-error" : undefined} />
              {currencyError ? <FieldError id="catalog-currency-error">{currencyError}</FieldError> : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="catalog-price">Public unit price <RequiredMark /></FieldLabel>
              <Input id="catalog-price" value={form.public_unit_price} inputMode="decimal" onChange={(event) => { setForm((current) => ({ ...current, public_unit_price: event.target.value })); if (priceError) setPriceError(null); }} aria-invalid={Boolean(priceError)} aria-describedby={priceError ? "catalog-price-error" : undefined} />
              {priceError ? <FieldError id="catalog-price-error">{priceError}</FieldError> : null}
            </Field>
            {costIsAverage ? (
              <Field>
                <FieldLabel htmlFor="catalog-cost">Average cost</FieldLabel>
                <Input id="catalog-cost" value={form.cost_price} readOnly aria-describedby="catalog-cost-description" />
                <FieldDescription id="catalog-cost-description">The average cost of the stock on hand, in {baseCurrency.data ?? "the base currency"}. Change it with Revalue on the Stock tab.</FieldDescription>
              </Field>
            ) : (
              <Field>
                <FieldLabel htmlFor="catalog-cost">Cost</FieldLabel>
                <Input id="catalog-cost" value={form.cost_price} inputMode="decimal" onChange={(event) => { setForm((current) => ({ ...current, cost_price: event.target.value })); if (costError) setCostError(null); }} aria-invalid={Boolean(costError)} aria-describedby={costError ? "catalog-cost-error" : "catalog-cost-description"} />
                {costError ? <FieldError id="catalog-cost-error">{costError}</FieldError> : <FieldDescription id="catalog-cost-description">What one {form.unit || "unit"} costs you, in {baseCurrency.data ?? "the base currency"}{isProduct && form.track_inventory ? "; the starting average cost once stock arrives" : ""}. Internal only: never shown to customers.</FieldDescription>}
              </Field>
            )}
          </FieldGroup>
        </FormSection>

        {isProduct ? (
          <FormSection title="Shipping details" description="Weight and size, for shipping quotes and carriers.">
            <FieldGroup columns={2}>
              <Field>
                <FieldLabel htmlFor="catalog-weight">Weight</FieldLabel>
                <Input id="catalog-weight" type="number" min="0" step="0.001" inputMode="decimal" value={form.weight} onChange={(event) => { setForm((current) => ({ ...current, weight: event.target.value })); setPhysicalError(null); }} aria-invalid={Boolean(physicalError)} aria-describedby={physicalError ? "catalog-physical-error" : undefined} />
              </Field>
              <Field>
                <FieldLabel htmlFor="catalog-weight-unit">Weight unit</FieldLabel>
                <Select value={form.weight_unit} onValueChange={(weight_unit) => setForm((current) => ({ ...current, weight_unit }))}>
                  <SelectTrigger id="catalog-weight-unit"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {WEIGHT_UNITS.map((unit) => <SelectItem key={unit.value} value={unit.value}>{unit.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="catalog-length">Length</FieldLabel>
                <Input id="catalog-length" type="number" min="0" step="0.01" inputMode="decimal" value={form.length} onChange={(event) => { setForm((current) => ({ ...current, length: event.target.value })); setPhysicalError(null); }} />
              </Field>
              <Field>
                <FieldLabel htmlFor="catalog-width">Width</FieldLabel>
                <Input id="catalog-width" type="number" min="0" step="0.01" inputMode="decimal" value={form.width} onChange={(event) => { setForm((current) => ({ ...current, width: event.target.value })); setPhysicalError(null); }} />
              </Field>
              <Field>
                <FieldLabel htmlFor="catalog-height">Height</FieldLabel>
                <Input id="catalog-height" type="number" min="0" step="0.01" inputMode="decimal" value={form.height} onChange={(event) => { setForm((current) => ({ ...current, height: event.target.value })); setPhysicalError(null); }} />
              </Field>
              <Field>
                <FieldLabel htmlFor="catalog-dimension-unit">Dimension unit</FieldLabel>
                <Select value={form.dimension_unit} onValueChange={(dimension_unit) => setForm((current) => ({ ...current, dimension_unit }))}>
                  <SelectTrigger id="catalog-dimension-unit"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DIMENSION_UNITS.map((unit) => <SelectItem key={unit.value} value={unit.value}>{unit.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              {physicalError ? <FieldError id="catalog-physical-error" className="md:col-span-2">{physicalError}</FieldError> : null}
            </FieldGroup>
          </FormSection>
        ) : null}

        {isProduct ? (
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
                <Input id="catalog-stock-quantity" value={form.track_inventory ? form.stock_quantity : ""} disabled={!form.track_inventory || Boolean(record?.track_inventory)} inputMode="decimal" onChange={(event) => { setForm((current) => ({ ...current, stock_quantity: event.target.value })); if (stockError) setStockError(null); }} aria-invalid={Boolean(stockError)} aria-describedby={stockError ? "catalog-stock-error" : undefined} placeholder="0" />
                {stockError ? <FieldError id="catalog-stock-error">{stockError}</FieldError> : null}
                {mode === "edit" && record?.track_inventory ? <FieldDescription>Use Adjust stock on the product record to change this balance.</FieldDescription> : null}
              </Field>
              {form.track_inventory ? <><Field><FieldLabel htmlFor="catalog-reorder-point">Reorder point</FieldLabel><Input id="catalog-reorder-point" type="number" min="0" step="0.0001" value={form.reorder_point} onChange={(event) => { setForm((current) => ({ ...current, reorder_point: event.target.value })); setReorderError(null); }} aria-invalid={Boolean(reorderError)} aria-describedby={reorderError ? "catalog-reorder-error" : undefined} /><FieldDescription>Alert when available stock reaches this quantity. Zero turns alerts off.</FieldDescription>{reorderError ? <FieldError id="catalog-reorder-error">{reorderError}</FieldError> : null}</Field><Field><FieldLabel htmlFor="catalog-reorder-quantity">Reorder quantity</FieldLabel><Input id="catalog-reorder-quantity" type="number" min="0" step="0.0001" value={form.reorder_quantity} onChange={(event) => { setForm((current) => ({ ...current, reorder_quantity: event.target.value })); setReorderError(null); }} /></Field></> : null}
            </FieldGroup>
          </FormSection>
        ) : null}

        {isProduct && form.track_inventory ? (
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
        <RecordCustomFieldsSection
          moduleKey={isProduct ? "catalog_products" : "catalog_services"}
          values={form.custom_fields}
          onChange={(custom_fields) => setForm((current) => ({ ...current, custom_fields }))}
        />
      </RecordFormLayout>
    </PageShell>
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
