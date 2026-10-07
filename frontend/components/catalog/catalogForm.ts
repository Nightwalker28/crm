/**
 * The one product and service form value and payload (13b Phase 5): the full form, the quick
 * create and a clone all start from `catalogFormSeed` and save through `buildCatalogPayload`.
 */

import type { RecordFormValue } from "@/components/forms/RecordForm";
import type { CatalogRecord, CatalogRecordPayload } from "@/hooks/catalog/useCatalogRecords";

/** The form's value: flat, keyed by field key, as `RecordForm` draws it (13b Phase 4e). */
export type CatalogFormState = RecordFormValue & {
  name: string;
  slug: string;
  description: string;
  sku: string;
  barcode: string;
  category_id: number | null;
  category_name: string;
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

// The backend's fixed lists (13b §3.5): small enough not to be picklists.
export const WEIGHT_UNITS = [
  { value: "kg", label: "Kilograms (kg)" },
  { value: "g", label: "Grams (g)" },
  { value: "lb", label: "Pounds (lb)" },
  { value: "oz", label: "Ounces (oz)" },
];
export const DIMENSION_UNITS = [
  { value: "cm", label: "Centimetres (cm)" },
  { value: "m", label: "Metres (m)" },
  { value: "in", label: "Inches (in)" },
];

export const EMPTY_CATALOG_FORM: CatalogFormState = {
  name: "",
  slug: "",
  description: "",
  sku: "",
  barcode: "",
  category_id: null,
  category_name: "",
  unit: "unit",
  currency: "",
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

const decimalText = (value: number | string | null | undefined) => (value == null ? "" : String(value));

/**
 * A form value from a saved record, or from a clone draft's copied fields — the draft carries
 * a subset of the record's keys, and anything missing takes the empty form's value.
 */
export function catalogFormSeed(record?: Partial<CatalogRecord> | null): CatalogFormState {
  if (!record) return EMPTY_CATALOG_FORM;
  return {
    name: record.name ?? "",
    slug: record.slug ?? "",
    description: record.description ?? "",
    sku: record.sku ?? "",
    barcode: record.barcode ?? "",
    category_id: record.category_id ?? null,
    category_name: record.category_name ?? "",
    unit: record.unit ?? "unit",
    currency: record.currency ?? "",
    public_unit_price: String(record.public_unit_price ?? "0"),
    list_price: decimalText(record.list_price),
    tax_category: record.tax_category ?? "",
    cost_price: decimalText(record.cost_price),
    weight: decimalText(record.weight),
    weight_unit: record.weight_unit ?? "kg",
    length: decimalText(record.length),
    width: decimalText(record.width),
    height: decimalText(record.height),
    dimension_unit: record.dimension_unit ?? "cm",
    stock_status: record.stock_status ?? "untracked",
    stock_quantity: decimalText(record.stock_quantity),
    reorder_point: String(record.reorder_point ?? 0),
    reorder_quantity: String(record.reorder_quantity ?? 0),
    track_inventory: Boolean(record.track_inventory),
    preferred_vendor_id: record.preferred_vendor_id ?? null,
    preferred_vendor_name: record.preferred_vendor_name ?? "",
    vendor_sku: record.vendor_sku ?? "",
    lead_time_days: record.lead_time_days == null ? "" : String(record.lead_time_days),
    is_public: record.is_public ?? false,
    is_active: record.is_active ?? true,
  };
}

/** Blank is `undefined`; a value that is not zero or more is `null` (an error to show). */
export function optionalDecimal(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

export function requiredDecimal(value: string): number | null {
  const numeric = optionalDecimal(value);
  return numeric === undefined ? null : numeric;
}

/**
 * The create or update body. `null` when a number is not zero or more: the caller has
 * already shown the error on its field.
 */
export function buildCatalogPayload(
  form: CatalogFormState,
  customValues: Record<string, unknown>,
  {
    isProduct,
    currency,
    costIsAverage = false,
    stockIsTracked = false,
  }: {
    isProduct: boolean;
    /** The currency to save: the form's, else the company's base currency. */
    currency: string;
    /** A tracked product's cost is its moving average, changed by Revalue (12d §5 decision 3). */
    costIsAverage?: boolean;
    /** An edited product that already tracks stock: its quantity moves through documents. */
    stockIsTracked?: boolean;
  },
): CatalogRecordPayload | null {
  const price = requiredDecimal(form.public_unit_price);
  const stockQuantity = optionalDecimal(form.stock_quantity);
  const cost = optionalDecimal(form.cost_price);
  if (
    price == null
    || stockQuantity === null
    || (!costIsAverage && cost === null)
    || requiredDecimal(form.reorder_point) === null
    || requiredDecimal(form.reorder_quantity) === null
  ) {
    return null;
  }
  const leadTime = form.lead_time_days.trim();
  return {
    name: form.name.trim(),
    slug: form.slug.trim().toLowerCase() || null,
    description: form.description.trim() || null,
    sku: form.sku.trim() || null,
    barcode: isProduct ? form.barcode.trim() || null : undefined,
    category_id: form.category_id,
    unit: form.unit,
    cost_price: costIsAverage ? undefined : cost ?? null,
    currency: currency.trim().toUpperCase(),
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
    stock_quantity: isProduct && !stockIsTracked && form.track_inventory ? stockQuantity ?? null : undefined,
    track_inventory: isProduct ? form.track_inventory : undefined,
    reorder_point: isProduct ? Number(form.reorder_point) : undefined,
    reorder_quantity: isProduct ? Number(form.reorder_quantity) : undefined,
    preferred_vendor_id: isProduct ? form.preferred_vendor_id : undefined,
    vendor_sku: isProduct ? form.vendor_sku.trim() || null : undefined,
    lead_time_days: isProduct
      ? (leadTime && Number.isInteger(Number(leadTime)) && Number(leadTime) >= 0 ? Number(leadTime) : null)
      : undefined,
    is_public: form.is_public,
    is_active: form.is_active,
    custom_fields: customValues,
  };
}
