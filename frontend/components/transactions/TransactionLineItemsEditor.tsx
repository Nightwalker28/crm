"use client";

import { useMemo, useState } from "react";

import { CatalogItemQuickCreate } from "@/components/catalog/CatalogItemQuickCreate";
import LinkedRecordPicker, { type LinkedRecordOption } from "@/components/crm/LinkedRecordPicker";
import { CUSTOM_TAX, LineTaxSelect, lineTaxValue } from "@/components/finance/tax/TaxRateSelect";
import { FormSection } from "@/components/forms/RecordFormLayout";
import { LineItemsEditor, LineNumberInput, LineTextInput, type LineItemsColumn } from "@/components/transactions/LineItemsEditor";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EMPTY_CELL_VALUE } from "@/components/ui/EmptyValue";
import { SegmentedControl, SegmentedItem } from "@/components/ui/SegmentedControl";
import type { CatalogRecord } from "@/hooks/catalog/useCatalogRecords";
import { useTaxRates, type TaxMode, type TaxRate } from "@/hooks/finance/useTaxRates";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { formatMoney } from "@/lib/currency";
import { computeLine, documentTotals, percentOf, toUnits, unitsToNumber, type LineAmounts } from "@/lib/money";

/**
 * One editable line. `catalog_product_id` / `catalog_service_id` record the catalog item the
 * line was picked from (at most one); a free-text line has neither. The line keeps its own
 * name and prices either way (docs/crm-evolution/12-erp-inventory.md §4.1).
 */
export type TransactionLineItem = {
  key: string;
  /** A saved line's ID. Orders send it back so the line keeps its identity (and stock holds). */
  id?: number | null;
  name: string;
  description: string;
  quantity: string;
  unit_price: string;
  discount_amount: string;
  /** The typed tax of a `tax_manual` line; otherwise the server computes it from the rate. */
  tax_amount: string;
  /** 13d §3.1: the line's rate; none and not manual = *Automatic* (the server picks). */
  tax_rate_id: number | null;
  tax_manual: boolean;
  /** *Custom amount* chosen in the editor, even while the amount is 0. Never sent. */
  tax_custom?: boolean;
  /** The picked catalog item's sales rate, for *Automatic*'s preview. Never sent. */
  item_tax_rate_id?: number | null;
  catalog_product_id: number | null;
  catalog_service_id: number | null;
  /** 13d §3.2: an item, or a section heading or note with no amounts. */
  line_type: TransactionLineType;
  /** Free text until F6.2 manages the list; "" = none. */
  unit: string;
  /** Quotes: offered, not sold; outside the total. */
  is_optional: boolean;
};
export type TransactionLineType = "item" | "section" | "note";
export type TransactionTotals = { subtotal: number; discount: number; tax: number; total: number };
/** What a line's tax preview needs: the rates, the company's default and the document's mode. */
export type TransactionTaxContext = { inclusive: boolean; rates: TaxRate[]; defaultRateId: number | null };
type ItemField = "name" | "description" | "quantity" | "unit_price" | "discount_amount" | "tax_amount" | "unit";
type CatalogLinkSource = { catalog_product_id?: number | null; catalog_service_id?: number | null };
let itemCounter = 0;

const NO_TAX_CONTEXT: TransactionTaxContext = { inclusive: false, rates: [], defaultRateId: null };

export function createTransactionLineItem(prefix = "transaction", lineType: TransactionLineType = "item"): TransactionLineItem {
  itemCounter += 1;
  return {
    key: `${prefix}-item-${itemCounter}`, name: "", description: "", quantity: "1", unit_price: "0", discount_amount: "0", tax_amount: "0",
    tax_rate_id: null, tax_manual: lineType !== "item", catalog_product_id: null, catalog_service_id: null, line_type: lineType, unit: "", is_optional: false,
  };
}
/** A saved line's kind, unit, optional flag and discount ("10%" when it was a percentage). */
export function transactionLineFields(line: {
  line_type?: string | null; unit?: string | null; is_optional?: boolean | null; discount_percent?: string | number | null; discount_amount?: unknown;
}) {
  const lineType: TransactionLineType = line.line_type === "section" || line.line_type === "note" ? line.line_type : "item";
  const percent = line.discount_percent;
  return {
    line_type: lineType,
    unit: line.unit ?? "",
    is_optional: Boolean(line.is_optional),
    discount_amount: percent !== null && percent !== undefined && percent !== "" ? `${Number(percent)}%` : String(line.discount_amount ?? "0"),
  };
}
/** "10%" is a percentage, never ten units of money (13a H14, D10); anything else is an amount. */
export function parseTransactionDiscount(value: string): { percent: string | null; amount: string } {
  const text = value.trim();
  if (text.endsWith("%")) return { percent: text.slice(0, -1).trim() || "0", amount: "0" };
  return { percent: null, amount: text || "0" };
}
/** A saved line's catalog link, for seeding the editor from a loaded document. */
export function transactionCatalogLink(line: CatalogLinkSource) { return { catalog_product_id: line.catalog_product_id ?? null, catalog_service_id: line.catalog_service_id ?? null }; }
/** A saved line's tax, for seeding the editor from a loaded document. */
export function transactionTaxFields(line: { tax_rate_id?: number | null; tax_manual?: boolean | null; tax_amount?: unknown }) {
  return { tax_rate_id: line.tax_rate_id ?? null, tax_manual: Boolean(line.tax_manual), tax_amount: String(line.tax_amount ?? "0") };
}
export function transactionAmount(value: string) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }

/** The rate a line's preview uses: its own, else the item's, else the company default. The
 * server also knows the account's exemption, so a saved line can differ; its figures win. */
export function transactionLineRate(item: TransactionLineItem, tax: TransactionTaxContext): TaxRate | null {
  if (item.tax_manual) return null;
  const rateId = item.tax_rate_id ?? item.item_tax_rate_id ?? tax.defaultRateId;
  return tax.rates.find((rate) => rate.id === rateId && (rate.is_active || rate.id === item.tax_rate_id)) ?? null;
}

export function transactionLineAmounts(item: TransactionLineItem, tax: TransactionTaxContext = NO_TAX_CONTEXT): LineAmounts {
  if (item.line_type !== "item") return computeLine({ quantity: "0", unitPrice: "0" });
  const rate = transactionLineRate(item, tax);
  const discount = parseTransactionDiscount(item.discount_amount);
  const gross = computeLine({ quantity: item.quantity, unitPrice: item.unit_price }).gross;
  return computeLine({
    quantity: item.quantity,
    unitPrice: item.unit_price,
    discount: discount.percent === null ? discount.amount : String(unitsToNumber(percentOf(gross, discount.percent))),
    rate: item.tax_manual ? null : (rate?.rate ?? "0"),
    tax: item.tax_amount,
    inclusive: tax.inclusive,
  });
}
export function transactionLineTotal(item: TransactionLineItem, tax: TransactionTaxContext = NO_TAX_CONTEXT) { return unitsToNumber(transactionLineAmounts(item, tax).total); }
/** Sections, notes and optional lines are outside the total (13d §3.2). */
export function calculateTransactionTotals(items: TransactionLineItem[], tax: TransactionTaxContext = NO_TAX_CONTEXT): TransactionTotals {
  return documentTotals(items.filter((item) => item.line_type === "item" && !item.is_optional).map((item) => transactionLineAmounts(item, tax)));
}
export function areTransactionItemsValid(items: TransactionLineItem[]) {
  return items.some((item) => item.line_type === "item") && items.every((item) => {
    if (!item.name.trim()) return false;
    if (item.line_type !== "item") return true;
    const discount = parseTransactionDiscount(item.discount_amount);
    const gross = toUnits(item.quantity) * toUnits(item.unit_price);
    const discountOk = discount.percent !== null
      ? transactionAmount(discount.percent) >= 0 && transactionAmount(discount.percent) <= 100
      : transactionAmount(discount.amount) >= 0 && toUnits(discount.amount) * BigInt(10000) <= gross;
    return transactionAmount(item.quantity) > 0 && transactionAmount(item.unit_price) >= 0 && transactionAmount(item.tax_amount) >= 0 && discountOk;
  });
}
export function serializeTransactionItems(items: TransactionLineItem[]) {
  return items.map((item, index) => {
    const discount = parseTransactionDiscount(item.discount_amount);
    return {
      ...(item.id ? { id: item.id } : {}),
      ...transactionCatalogLink(item),
      line_type: item.line_type,
      name: item.name.trim(),
      description: item.description.trim() || null,
      quantity: item.line_type === "item" ? item.quantity : "1",
      unit_price: item.line_type === "item" ? item.unit_price : "0",
      discount_amount: discount.amount,
      discount_percent: discount.percent,
      unit: item.unit.trim() || null,
      is_optional: item.is_optional,
      tax_rate_id: item.tax_rate_id,
      tax_manual: item.tax_manual,
      tax_amount: item.tax_manual ? item.tax_amount : "0",
      sort_order: index,
    };
  });
}

/** The rates, the company's default sales rate and the document's mode, for line previews. */
export function useTransactionTax(mode: TaxMode): TransactionTaxContext {
  const rates = useTaxRates();
  return useMemo(() => {
    const list = rates.data ?? [];
    return { inclusive: mode === "inclusive", rates: list, defaultRateId: list.find((rate) => rate.is_active && rate.is_default_sales)?.id ?? null };
  }, [rates.data, mode]);
}

/** A clone draft's copied lines as new editor lines: no ids, so each saves as a new line (13b Phase 5). */
export function transactionItemsFromCopy(lines: Array<Record<string, unknown>>, prefix: string): TransactionLineItem[] {
  if (!lines.length) return [createTransactionLineItem(prefix)];
  const text = (value: unknown, fallback = "") => (value === null || value === undefined ? fallback : String(value));
  return lines.map((line) => ({
    ...createTransactionLineItem(prefix),
    ...transactionCatalogLink(line as CatalogLinkSource),
    name: text(line.name),
    description: text(line.description),
    quantity: text(line.quantity, "1"),
    unit_price: text(line.unit_price, "0"),
    ...transactionTaxFields(line as { tax_rate_id?: number | null; tax_manual?: boolean; tax_amount?: unknown }),
    ...transactionLineFields(line as Parameters<typeof transactionLineFields>[0]),
  }));
}

/** The first line of a catalog description, short enough for the line's one-line field. */
function catalogDescriptionLine(value: unknown) {
  if (typeof value !== "string") return "";
  const firstLine = value.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
  return firstLine.length > 240 ? `${firstLine.slice(0, 239)}…` : firstLine;
}
export function formatTransactionMoney(value: number, currency: string) { return formatMoney(value, currency, { maximumFractionDigits: 2 }) ?? EMPTY_CELL_VALUE; }

/**
 * Quote, order and invoice lines (design.md §7.10, `lineItems`): the shared `LineItemsEditor`
 * with the transaction columns. The description sits under the item, as Odoo and Zoho draw it,
 * so the item keeps the widest column and Tax, Total and remove stay in view in a 1280px form
 * (13a H15).
 */
export function TransactionLineItemsEditor({
  items,
  onChange,
  currency,
  error,
  idPrefix,
  itemLabel = "Item",
  showDescription = true,
  showAdjustments = true,
  taxMode = "exclusive",
  onTaxModeChange,
  allowOptional = false,
}: {
  items: TransactionLineItem[];
  onChange: (items: TransactionLineItem[]) => void;
  currency: string;
  error?: string | null;
  idPrefix: string;
  itemLabel?: string;
  showDescription?: boolean;
  showAdjustments?: boolean;
  /** Whether the prices include tax (13d §3.1); the switch shows when it can change. */
  taxMode?: TaxMode;
  onTaxModeChange?: (mode: TaxMode) => void;
  /** Quotes: a line can be offered as optional, outside the total (13d §3.2). */
  allowOptional?: boolean;
}) {
  const tax = useTransactionTax(taxMode);
  // The unit column shows once any line has a unit other than "unit" (13d §3.2).
  const showUnits = items.some((item) => item.line_type === "item" && item.unit.trim() && item.unit.trim() !== "unit");
  const { modules } = useAccessibleModules();
  // The picker offers what the user may see; with neither catalog module the item cell stays
  // plain text, and any link a line already has is kept as it is.
  const canPickCatalog = modules.some((module) => (module.name === "catalog_products" || module.name === "catalog_services") && module.actions?.can_view);
  // *Create product "…"* (13b Phase 5): a new product, priced in this document's currency, on this line.
  const canCreateProduct = modules.some((module) => module.name === "catalog_products" && module.actions?.can_create);
  const [creating, setCreating] = useState<{ index: number; name: string } | null>(null);

  function pickCreatedProduct(record: CatalogRecord) {
    if (!creating) return;
    pickCatalogItem(creating.index, {
      id: record.id,
      label: record.name,
      raw: { kind: "product", unit_price: record.list_price ?? record.public_unit_price, description: record.description },
    });
  }

  function updateItem(index: number, field: ItemField, value: string) {
    onChange(items.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)));
  }

  function pickCatalogItem(index: number, option: LinkedRecordOption) {
    const raw = (option.raw ?? {}) as Record<string, unknown>;
    const isService = raw.kind === "service";
    onChange(items.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      return {
        ...item,
        name: option.label,
        description: showDescription && !item.description.trim() ? catalogDescriptionLine(raw.description) : item.description,
        unit_price: raw.unit_price == null ? item.unit_price : String(raw.unit_price),
        unit: typeof raw.unit === "string" && raw.unit !== "unit" ? raw.unit : item.unit,
        item_tax_rate_id: typeof raw.tax_rate_id === "number" ? raw.tax_rate_id : null,
        catalog_product_id: isService ? null : option.id,
        catalog_service_id: isService ? option.id : null,
      };
    }));
    requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>(`[data-line-editor="${idPrefix}"][data-line-row="${index}"][data-line-field="quantity"]`)?.focus();
    });
  }

  function unlinkCatalogItem(index: number) {
    onChange(items.map((item, itemIndex) => (itemIndex === index ? { ...item, catalog_product_id: null, catalog_service_id: null } : item)));
  }

  const amount = (field: ItemField, label: string, share: number): LineItemsColumn<TransactionLineItem> => ({
    key: field,
    label,
    size: "sm",
    share,
    render: (item, { index, cellProps }) => (item.line_type !== "item" ? null : (
      <LineNumberInput
        cellProps={cellProps(field)}
        value={item[field]}
        onChange={(value) => updateItem(index, field, value)}
        ariaLabel={`${field.replaceAll("_", " ")} line ${index + 1}`}
      />
    )),
  });

  const discountColumn: LineItemsColumn<TransactionLineItem> = {
    key: "discount_amount",
    label: "Discount",
    size: "sm",
    share: 1.25,
    render: (item, { index, cellProps }) => (item.line_type !== "item" ? null : (
      <LineTextInput
        cellProps={cellProps("discount_amount")}
        value={item.discount_amount === "0" ? "" : item.discount_amount}
        onChange={(value) => updateItem(index, "discount_amount", value)}
        ariaLabel={`discount line ${index + 1}, an amount or a percentage like 10%`}
        placeholder="0 or 10%"
      />
    )),
  };

  const unitColumn: LineItemsColumn<TransactionLineItem> = {
    key: "unit",
    label: "Unit",
    size: "sm",
    share: 1,
    render: (item, { index, cellProps }) => (item.line_type !== "item" ? null : (
      <LineTextInput cellProps={cellProps("unit")} value={item.unit} onChange={(value) => updateItem(index, "unit", value)} ariaLabel={`unit line ${index + 1}`} />
    )),
  };

  function updateTax(index: number, next: { tax_rate_id: number | null; tax_manual: boolean; tax_custom?: boolean; tax_amount?: string }) {
    onChange(items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...next, tax_amount: next.tax_amount ?? item.tax_amount } : item)));
  }

  const taxColumn: LineItemsColumn<TransactionLineItem> = {
    key: "tax",
    label: "Tax",
    size: "md",
    share: 1.75,
    render: (item, { index, cellProps }) => {
      if (item.line_type !== "item") return null;
      const autoRate = transactionLineRate({ ...item, tax_rate_id: null, tax_manual: false }, tax);
      return (
        <div className="flex min-w-0 flex-col gap-1.5">
          <LineTaxSelect
            value={item}
            onChange={(next) => updateTax(index, next)}
            ariaLabel={`tax line ${index + 1}`}
            autoLabel={autoRate ? `Automatic (${autoRate.name})` : "Automatic"}
          />
          {lineTaxValue(item) === CUSTOM_TAX ? (
            <LineNumberInput
              cellProps={cellProps("tax_amount")}
              value={item.tax_amount}
              onChange={(value) => updateItem(index, "tax_amount", value)}
              ariaLabel={`tax amount line ${index + 1}`}
            />
          ) : null}
        </div>
      );
    },
  };

  const columns: LineItemsColumn<TransactionLineItem>[] = [
    {
      key: "name",
      label: itemLabel,
      size: "lg",
      share: 4,
      render: (item, { index, cellProps }) => {
        const nameCell = cellProps("name");
        if (item.line_type !== "item") {
          // A section heading or a note: text only, no amounts (13d §3.2).
          return (
            <LineTextInput
              cellProps={nameCell}
              value={item.name}
              onChange={(value) => updateItem(index, "name", value)}
              ariaLabel={`${item.line_type} line ${index + 1}`}
              placeholder={item.line_type === "section" ? "Section heading" : "Note for the customer"}
            />
          );
        }
        const name = canPickCatalog ? (
          // Typing searches the catalog; choosing fills the line, and anything typed without
          // choosing is a custom line. Renaming a picked line keeps its link (HubSpot).
          <LinkedRecordPicker
            recordType="catalog_item"
            ariaLabel={`name line ${index + 1}`}
            valueId={item.catalog_product_id ?? item.catalog_service_id}
            displayValue={item.name}
            onDisplayValueChange={(value) => updateItem(index, "name", value)}
            onSelect={(option) => pickCatalogItem(index, option)}
            onClear={() => unlinkCatalogItem(index)}
            clearLabel={`Unlink line ${index + 1} from the catalog`}
            placeholder="Search the catalog or type an item"
            noResultsText={`No active ${currency} products or services match. Keep typing to add a custom line.`}
            filters={{ currency }}
            queryKeyPrefix="transaction-catalog-item"
            onInputKeyDown={nameCell.onKeyDown}
            inputDataAttributes={{ "data-line-editor": nameCell["data-line-editor"], "data-line-row": index, "data-line-field": "name" }}
            createOption={canCreateProduct ? { label: (text) => `Create product "${text}"`, onCreate: (text) => setCreating({ index, name: text }) } : undefined}
          />
        ) : (
          <LineTextInput
            cellProps={nameCell}
            value={item.name}
            onChange={(value) => updateItem(index, "name", value)}
            ariaLabel={`name line ${index + 1}`}
            placeholder="Service or product"
          />
        );
        const optional = allowOptional ? (
          <label className="flex items-center gap-2 text-xs text-copy-secondary">
            <Checkbox
              checked={item.is_optional}
              onCheckedChange={(checked) => onChange(items.map((row, rowIndex) => (rowIndex === index ? { ...row, is_optional: checked === true } : row)))}
              aria-label={`Optional line ${index + 1}`}
            />
            Optional: the customer can add it
          </label>
        ) : null;
        if (!showDescription && !optional) return name;
        return (
          <div className="flex min-w-0 flex-col gap-1.5">
            {name}
            {showDescription ? (
              <LineTextInput
                cellProps={cellProps("description")}
                value={item.description}
                onChange={(value) => updateItem(index, "description", value)}
                ariaLabel={`description line ${index + 1}`}
                placeholder="Description (optional)"
              />
            ) : null}
            {optional}
          </div>
        );
      },
    },
    amount("quantity", "Qty", 1),
    ...(showUnits ? [unitColumn] : []),
    amount("unit_price", "Unit price", 1.5),
    ...(showAdjustments ? [discountColumn, taxColumn] : []),
    {
      key: "line_total",
      label: "Total",
      align: "right",
      size: "sm",
      share: 1.5,
      render: (item) => (item.line_type !== "item" ? null : (
        <span className={item.is_optional ? "block truncate text-sm tabular-nums text-copy-muted" : "block truncate text-sm font-medium tabular-nums text-copy-primary"}>
          {formatTransactionMoney(transactionLineTotal(item, tax), currency)}
        </span>
      )),
    },
  ];

  return (
    <FormSection
      title="Line items"
      description="Press Enter in a cell to move to the same field on the next row; Enter on the last row adds another item."
    >
      {onTaxModeChange ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-sm text-copy-secondary">Amounts are</span>
          <SegmentedControl value={taxMode} onValueChange={onTaxModeChange} aria-label="Tax on amounts">
            <SegmentedItem value="exclusive">Tax exclusive</SegmentedItem>
            <SegmentedItem value="inclusive">Tax inclusive</SegmentedItem>
          </SegmentedControl>
        </div>
      ) : null}
      <LineItemsEditor
        id={idPrefix}
        label="Line items"
        lines={items}
        lineKey={(item) => item.key}
        columns={columns}
        onChange={onChange}
        createLine={() => createTransactionLineItem(idPrefix)}
        addLabel="Add line item"
        reorderable
        duplicateLine={(line) => ({ ...line, key: createTransactionLineItem(idPrefix).key, id: null })}
        extraAddActions={(
          <>
            <Button type="button" variant="ghost" onClick={() => onChange([...items, createTransactionLineItem(idPrefix, "section")])}>Add section</Button>
            <Button type="button" variant="ghost" onClick={() => onChange([...items, createTransactionLineItem(idPrefix, "note")])}>Add note</Button>
          </>
        )}
        lineLabel={(item, index) => item.name || `line ${index + 1}`}
        error={error}
      />
      {canCreateProduct ? (
        <CatalogItemQuickCreate
          kind="products"
          open={creating !== null}
          onOpenChange={(open) => { if (!open) setCreating(null); }}
          embedded
          context={{ relationshipIntent: "document_line", defaults: { name: creating?.name ?? "", currency } }}
          onCreated={pickCreatedProduct}
        />
      ) : null}
    </FormSection>
  );
}
