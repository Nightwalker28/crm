"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBackdrop,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { DialogIconClose } from "@/components/ui/DialogIconClose";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox, CheckboxIndicator } from "@/components/ui/checkbox";
import type { CatalogKind, CatalogRecord, CatalogRecordPayload } from "@/hooks/catalog/useCatalogRecords";
import { resolveMediaUrl } from "@/lib/media";

type Props = {
  open: boolean;
  kind: CatalogKind;
  record: CatalogRecord | null;
  isSubmitting?: boolean;
  onClose: () => void;
  onSubmit: (payload: CatalogRecordPayload, mediaFile: File | null) => Promise<void>;
};

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

const emptyForm: FormState = {
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

function RequiredAsterisk() {
  return <span className="text-red-400">*</span>;
}

function toFormState(record: CatalogRecord | null): FormState {
  if (!record) return emptyForm;
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
  return Number.isFinite(numeric) ? numeric : null;
}

function requiredDecimal(value: string): number | null {
  const numeric = Number(value.trim());
  return Number.isFinite(numeric) ? numeric : null;
}

export default function CatalogRecordDialog({
  open,
  kind,
  record,
  isSubmitting = false,
  onClose,
  onSubmit,
}: Props) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isProduct = kind === "products";
  const noun = isProduct ? "Product" : "Service";

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm(toFormState(record));
      setMediaFile(null);
      setError(null);
    }
  }, [open, record]);

  const canSubmit = useMemo(() => {
    return Boolean(form.name.trim()) && requiredDecimal(form.public_unit_price) != null && form.currency.trim().length === 3;
  }, [form.currency, form.name, form.public_unit_price]);

  function handleClose() {
    setForm(emptyForm);
    setMediaFile(null);
    setError(null);
    onClose();
  }

  async function handleSubmit() {
    const price = requiredDecimal(form.public_unit_price);
    const stockQuantity = optionalDecimal(form.stock_quantity);
    if (!form.name.trim() || price == null || stockQuantity === null) {
      setError("Name, currency, price, and stock quantity must be valid.");
      return;
    }

    try {
      setError(null);
      await onSubmit(
        {
          name: form.name.trim(),
          slug: form.slug.trim() || null,
          description: form.description.trim() || null,
          sku: isProduct ? form.sku.trim() || null : undefined,
          currency: form.currency.trim().toUpperCase() || "USD",
          public_unit_price: price,
          stock_status: isProduct ? form.stock_status : undefined,
          stock_quantity: isProduct ? stockQuantity ?? null : undefined,
          is_public: form.is_public,
          is_active: form.is_active,
        },
        mediaFile,
      );
      handleClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : `Failed to save ${noun.toLowerCase()}`);
    }
  }

  return (
    <Dialog open={open} onClose={handleClose}>
      <DialogBackdrop />
      <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
        <DialogPanel size="2xl" className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{record ? `Edit ${noun}` : `Create ${noun}`}</DialogTitle>
            <DialogIconClose />
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {error ? (
              <div className="rounded-md border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            ) : null}

            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <Field className="sm:col-span-2">
                <FieldLabel>
                  Name <RequiredAsterisk />
                </FieldLabel>
                <Input
                  value={form.name}
                  maxLength={180}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder={isProduct ? "Camera kit" : "Installation service"}
                />
              </Field>

              {isProduct ? (
                <Field>
                  <FieldLabel>SKU</FieldLabel>
                  <Input
                    value={form.sku}
                    maxLength={100}
                    onChange={(event) => setForm((current) => ({ ...current, sku: event.target.value }))}
                    placeholder="CAM-KIT"
                  />
                </Field>
              ) : null}

              <Field>
                <FieldLabel>Public Slug</FieldLabel>
                <Input
                  value={form.slug}
                  maxLength={160}
                  onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))}
                  placeholder={isProduct ? "camera-kit" : "installation-service"}
                />
              </Field>

              <Field>
                <FieldLabel>
                  Currency <RequiredAsterisk />
                </FieldLabel>
                <Input
                  value={form.currency}
                  maxLength={3}
                  onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))}
                  placeholder="USD"
                />
              </Field>

              <Field>
                <FieldLabel>
                  Public Unit Price <RequiredAsterisk />
                </FieldLabel>
                <Input
                  value={form.public_unit_price}
                  inputMode="decimal"
                  onChange={(event) => setForm((current) => ({ ...current, public_unit_price: event.target.value }))}
                />
              </Field>

              {isProduct ? (
                <>
                  <Field>
                    <FieldLabel>Stock Status</FieldLabel>
                    <Select
                      value={form.stock_status}
                      onValueChange={(value) => setForm((current) => ({ ...current, stock_status: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Stock status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="untracked">Untracked</SelectItem>
                        <SelectItem value="in_stock">In stock</SelectItem>
                        <SelectItem value="out_of_stock">Out of stock</SelectItem>
                        <SelectItem value="preorder">Preorder</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel>Stock Quantity</FieldLabel>
                    <Input
                      value={form.stock_quantity}
                      inputMode="decimal"
                      onChange={(event) => setForm((current) => ({ ...current, stock_quantity: event.target.value }))}
                      placeholder="Blank for untracked"
                    />
                  </Field>
                </>
              ) : null}

              <Field className="sm:col-span-2">
                <FieldLabel>Description</FieldLabel>
                <Textarea
                  value={form.description}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  className="min-h-24"
                />
              </Field>

              <Field className="sm:col-span-2">
                <FieldLabel>Media</FieldLabel>
                <div className="flex flex-col gap-3 rounded-md border border-neutral-800 bg-neutral-950/60 p-3 sm:flex-row sm:items-center">
                  {record?.media_url ? (
                    <Image
                      src={resolveMediaUrl(record.media_url)}
                      alt=""
                      width={64}
                      height={64}
                      unoptimized
                      className="h-16 w-16 rounded-md object-cover"
                    />
                  ) : (
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-dashed border-neutral-700 text-xs text-neutral-600">
                      No media
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={(event) => setMediaFile(event.target.files?.[0] ?? null)}
                    />
                    <FieldDescription className="mt-1">
                      Upload an image through the catalog media endpoint.
                    </FieldDescription>
                    {mediaFile ? <p className="mt-1 text-xs text-neutral-400">{mediaFile.name}</p> : null}
                  </div>
                </div>
              </Field>

              <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
                <label className="flex items-center justify-between gap-3 rounded-md border border-neutral-800 bg-neutral-950/60 px-3 py-3 text-sm text-neutral-300">
                  <span>Public website feed</span>
                  <Checkbox
                    checked={form.is_public}
                    onCheckedChange={(checked) => setForm((current) => ({ ...current, is_public: checked === true }))}
                    className="flex h-4 w-4 items-center justify-center rounded border border-neutral-700 bg-neutral-900 text-white"
                  >
                    <CheckboxIndicator className="h-3 w-3" />
                  </Checkbox>
                </label>
                <label className="flex items-center justify-between gap-3 rounded-md border border-neutral-800 bg-neutral-950/60 px-3 py-3 text-sm text-neutral-300">
                  <span>Active</span>
                  <Checkbox
                    checked={form.is_active}
                    onCheckedChange={(checked) => setForm((current) => ({ ...current, is_active: checked === true }))}
                    className="flex h-4 w-4 items-center justify-center rounded border border-neutral-700 bg-neutral-900 text-white"
                  >
                    <CheckboxIndicator className="h-3 w-3" />
                  </Checkbox>
                </label>
              </div>
            </FieldGroup>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
