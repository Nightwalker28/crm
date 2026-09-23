"use client";

import { formatSnakeCaseLabel } from "@/lib/module-display";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CatalogKind, CatalogRecord, CatalogRecordPayload } from "@/hooks/catalog/useCatalogRecords";
import { useCatalogRecord, useCatalogRecordActions } from "@/hooks/catalog/useCatalogRecords";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { formatDateTime } from "@/lib/datetime";
import { resolveMediaUrl } from "@/lib/media";

type FormState = {
  name: string;
  slug: string;
  description: string;
  sku: string;
  currency: string;
  public_unit_price: string;
  stock_status: string;
  stock_quantity: string;
  is_public: boolean;
  is_active: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  slug: "",
  description: "",
  sku: "",
  currency: "USD",
  public_unit_price: "0",
  stock_status: "untracked",
  stock_quantity: "",
  is_public: false,
  is_active: true,
};

function formSeed(record?: CatalogRecord): FormState {
  if (!record) return EMPTY_FORM;
  return {
    name: record.name ?? "",
    slug: record.slug ?? "",
    description: record.description ?? "",
    sku: record.sku ?? "",
    currency: record.currency ?? "USD",
    public_unit_price: String(record.public_unit_price ?? "0"),
    stock_status: record.stock_status ?? "untracked",
    stock_quantity: record.stock_quantity == null ? "" : String(record.stock_quantity),
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
  const [submitError, setSubmitError] = useState(false);
  const isProduct = kind === "products";
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
    setNameError(nextNameError);
    setCurrencyError(nextCurrencyError);
    setPriceError(nextPriceError);
    setStockError(nextStockError);
    if (nextNameError) document.getElementById("catalog-name")?.focus();
    else if (nextCurrencyError) document.getElementById("catalog-currency")?.focus();
    else if (nextPriceError) document.getElementById("catalog-price")?.focus();
    else if (nextStockError) document.getElementById("catalog-stock-quantity")?.focus();
    return !nextNameError && !nextCurrencyError && !nextPriceError && !nextStockError;
  }

  async function submit() {
    if (!validate() || actions.isSaving) return;
    const price = requiredDecimal(form.public_unit_price);
    const stockQuantity = optionalDecimal(form.stock_quantity);
    if (price == null || stockQuantity === null) return;
    const payload: CatalogRecordPayload = {
      name: form.name.trim(),
      slug: form.slug.trim().toLowerCase() || null,
      description: form.description.trim() || null,
      sku: isProduct ? form.sku.trim() || null : undefined,
      currency: form.currency.trim().toUpperCase(),
      public_unit_price: price,
      stock_status: isProduct ? form.stock_status : undefined,
      stock_quantity: isProduct ? stockQuantity ?? null : undefined,
      is_public: form.is_public,
      is_active: form.is_active,
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
                {record?.media_url ? (
                  <Image src={resolveMediaUrl(record.media_url)} alt="" width={320} height={240} unoptimized className="aspect-[4/3] w-full rounded-[var(--radius-control)] object-cover" />
                ) : (
                  <div className="flex aspect-[4/3] items-center justify-center rounded-[var(--radius-control)] border border-dashed border-line-strong text-sm text-copy-muted">No media uploaded</div>
                )}
                <Field>
                  <FieldLabel htmlFor="catalog-media">Image</FieldLabel>
                  <Input id="catalog-media" type="file" accept="image/*" onChange={(event) => setMediaFile(event.target.files?.[0] ?? null)} />
                  {mediaFile ? <FieldDescription>{mediaFile.name}</FieldDescription> : null}
                </Field>
              </div>
            </Card>
          </div>
        }
        status={dirty ? "Unsaved changes" : mode === "edit" ? "No unsaved changes" : `Complete the required fields to create this ${noun}.`}
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
            {isProduct ? (
              <Field>
                <FieldLabel htmlFor="catalog-sku">SKU</FieldLabel>
                <Input id="catalog-sku" value={form.sku} maxLength={100} onChange={(event) => setForm((current) => ({ ...current, sku: event.target.value }))} placeholder="CAM-KIT" />
              </Field>
            ) : null}
            <Field className={isProduct ? undefined : "md:col-span-2"}>
              <FieldLabel htmlFor="catalog-slug">Public slug</FieldLabel>
              <Input id="catalog-slug" value={form.slug} maxLength={160} onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))} placeholder={isProduct ? "camera-kit" : "installation-service"} />
            </Field>
            <Field className="md:col-span-2">
              <FieldLabel htmlFor="catalog-description">Description</FieldLabel>
              <Textarea id="catalog-description" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} rows={7} />
            </Field>
          </FieldGroup>
        </FormSection>

        <FormSection title="Pricing" description="Set the public base price used before customer-group pricing rules are applied.">
          <FieldGroup columns={2}>
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
          </FieldGroup>
        </FormSection>

        {isProduct ? (
          <FormSection title="Inventory" description="Track availability or leave quantity blank when inventory is managed elsewhere.">
            <FieldGroup columns={2}>
              <Field>
                <FieldLabel>Status</FieldLabel>
                <Select value={form.stock_status} onValueChange={(stock_status) => setForm((current) => ({ ...current, stock_status }))}>
                  <SelectTrigger aria-label="Stock status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="untracked">Untracked</SelectItem>
                    <SelectItem value="in_stock">In stock</SelectItem>
                    <SelectItem value="out_of_stock">Out of stock</SelectItem>
                    <SelectItem value="preorder">Preorder</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="catalog-stock-quantity">Stock quantity</FieldLabel>
                <Input id="catalog-stock-quantity" value={form.stock_quantity} inputMode="decimal" onChange={(event) => { setForm((current) => ({ ...current, stock_quantity: event.target.value })); if (stockError) setStockError(null); }} aria-invalid={Boolean(stockError)} aria-describedby={stockError ? "catalog-stock-error" : undefined} placeholder="Blank for untracked" />
                {stockError ? <FieldError id="catalog-stock-error">{stockError}</FieldError> : null}
              </Field>
            </FieldGroup>
          </FormSection>
        ) : null}
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
