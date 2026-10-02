"use client";

import { Plus, Trash2 } from "lucide-react";

import LinkedRecordPicker, { type LinkedRecordOption } from "@/components/crm/LinkedRecordPicker";
import { FormSection } from "@/components/forms/RecordFormLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RecordTable, type RecordTableColumn } from "@/components/ui/RecordTable";
import { EMPTY_CELL_VALUE } from "@/components/ui/EmptyValue";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { formatMoney } from "@/lib/currency";

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
  tax_amount: string;
  catalog_product_id: number | null;
  catalog_service_id: number | null;
};
export type TransactionTotals = { subtotal: number; discount: number; tax: number; total: number };
type ItemField = "name" | "description" | "quantity" | "unit_price" | "discount_amount" | "tax_amount";
type CatalogLinkSource = { catalog_product_id?: number | null; catalog_service_id?: number | null };
let itemCounter = 0;

export function createTransactionLineItem(prefix = "transaction"): TransactionLineItem { itemCounter += 1; return { key: `${prefix}-item-${itemCounter}`, name: "", description: "", quantity: "1", unit_price: "0", discount_amount: "0", tax_amount: "0", catalog_product_id: null, catalog_service_id: null }; }
/** A saved line's catalog link, for seeding the editor from a loaded document. */
export function transactionCatalogLink(line: CatalogLinkSource) { return { catalog_product_id: line.catalog_product_id ?? null, catalog_service_id: line.catalog_service_id ?? null }; }
export function transactionAmount(value: string) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
export function transactionLineTotal(item: TransactionLineItem) { return Math.max(0, transactionAmount(item.quantity) * transactionAmount(item.unit_price) - transactionAmount(item.discount_amount) + transactionAmount(item.tax_amount)); }
export function calculateTransactionTotals(items: TransactionLineItem[]): TransactionTotals { return items.reduce((result, item) => { result.subtotal += transactionAmount(item.quantity) * transactionAmount(item.unit_price); result.discount += transactionAmount(item.discount_amount); result.tax += transactionAmount(item.tax_amount); result.total += transactionLineTotal(item); return result; }, { subtotal: 0, discount: 0, tax: 0, total: 0 }); }
export function areTransactionItemsValid(items: TransactionLineItem[]) { return items.length > 0 && items.every((item) => item.name.trim() && transactionAmount(item.quantity) > 0 && transactionAmount(item.unit_price) >= 0 && transactionAmount(item.discount_amount) >= 0 && transactionAmount(item.tax_amount) >= 0 && transactionAmount(item.discount_amount) <= transactionAmount(item.quantity) * transactionAmount(item.unit_price) + transactionAmount(item.tax_amount)); }
export function serializeTransactionItems(items: TransactionLineItem[]) { return items.map((item, index) => ({ ...(item.id ? { id: item.id } : {}), ...transactionCatalogLink(item), name: item.name.trim(), description: item.description.trim() || null, quantity: item.quantity, unit_price: item.unit_price, discount_amount: item.discount_amount, tax_amount: item.tax_amount, sort_order: index })); }

/** The first line of a catalog description, short enough for the line's one-line field. */
function catalogDescriptionLine(value: unknown) {
  if (typeof value !== "string") return "";
  const firstLine = value.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
  return firstLine.length > 240 ? `${firstLine.slice(0, 239)}…` : firstLine;
}
export function formatTransactionMoney(value: number, currency: string) { return formatMoney(value, currency, { maximumFractionDigits: 2 }) ?? EMPTY_CELL_VALUE; }

/**
 * The editable grid inside a line-item document (design.md §7.10, `variant="lineItems"`).
 *
 * It is the one editable table in the app, and the reason the variant exists rather than a
 * second table: the difference from a module list is *shape* — an input per cell, an
 * add/remove row, Enter walking down a column — not a different set of rules about
 * padding, scroll region or states. It used to hand-assemble a raw `Table` with two
 * hardcoded `min-w-[Npx]` values chosen by eye; the min-width is derived from the columns
 * actually drawn now, so hiding Description or the adjustments narrows the grid instead of
 * leaving a scrollbar behind.
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
}: {
  items: TransactionLineItem[];
  onChange: (items: TransactionLineItem[]) => void;
  currency: string;
  error?: string | null;
  idPrefix: string;
  itemLabel?: string;
  showDescription?: boolean;
  showAdjustments?: boolean;
}) {
  const { modules } = useAccessibleModules();
  // The picker offers what the user may see; with neither catalog module the item cell stays
  // plain text, and any link a line already has is kept as it is.
  const canPickCatalog = modules.some((module) => (module.name === "catalog_products" || module.name === "catalog_services") && module.actions?.can_view);

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
        catalog_product_id: isService ? null : option.id,
        catalog_service_id: isService ? option.id : null,
      };
    }));
    requestAnimationFrame(() => focusCell(index, "quantity"));
  }

  function unlinkCatalogItem(index: number) {
    onChange(items.map((item, itemIndex) => (itemIndex === index ? { ...item, catalog_product_id: null, catalog_service_id: null } : item)));
  }

  function focusCell(index: number, field: ItemField) {
    document.querySelector<HTMLInputElement>(`[data-${idPrefix}-row="${index}"][data-transaction-field="${field}"]`)?.focus();
  }

  function addItem(focusField: ItemField = "name") {
    const nextIndex = items.length;
    onChange([...items, createTransactionLineItem(idPrefix)]);
    requestAnimationFrame(() => focusCell(nextIndex, focusField));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>, index: number, field: ItemField) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (index === items.length - 1) addItem(field);
    else focusCell(index + 1, field);
  }

  const columns: RecordTableColumn<TransactionLineItem>[] = [
    {
      key: "name",
      label: itemLabel,
      size: "lg",
      render: (item: TransactionLineItem) => {
        const index = items.indexOf(item);
        if (!canPickCatalog) {
          return (
            <ItemInput
              idPrefix={idPrefix}
              index={index}
              field="name"
              value={item.name}
              onChange={updateItem}
              onKeyDown={handleKeyDown}
              placeholder="Service or product"
            />
          );
        }
        // Typing searches the catalog; choosing fills the line, and anything typed without
        // choosing is a custom line. Renaming a picked line keeps its link (HubSpot).
        return (
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
            onInputKeyDown={(event) => handleKeyDown(event, index, "name")}
            inputDataAttributes={{ [`data-${idPrefix}-row`]: index, "data-transaction-field": "name" }}
          />
        );
      },
    },
    ...(showDescription
      ? [
        {
          key: "description",
          label: "Description",
          size: "lg" as const,
          render: (item: TransactionLineItem) => (
            <ItemInput
              idPrefix={idPrefix}
              index={items.indexOf(item)}
              field="description"
              value={item.description}
              onChange={updateItem}
              onKeyDown={handleKeyDown}
              placeholder="Optional details"
            />
          ),
        },
        ]
      : []),
    {
      key: "quantity",
      label: "Qty",
      size: "sm",
      render: (item: TransactionLineItem) => (
        <ItemInput
          idPrefix={idPrefix}
          index={items.indexOf(item)}
          field="quantity"
          value={item.quantity}
          onChange={updateItem}
          onKeyDown={handleKeyDown}
          type="number"
        />
      ),
    },
    {
      key: "unit_price",
      label: "Unit price",
      size: "sm",
      render: (item: TransactionLineItem) => (
        <ItemInput
          idPrefix={idPrefix}
          index={items.indexOf(item)}
          field="unit_price"
          value={item.unit_price}
          onChange={updateItem}
          onKeyDown={handleKeyDown}
          type="number"
        />
      ),
    },
    ...(showAdjustments
      ? [
        {
          key: "discount_amount",
          label: "Discount",
          size: "sm" as const,
          render: (item: TransactionLineItem) => (
            <ItemInput
              idPrefix={idPrefix}
              index={items.indexOf(item)}
              field="discount_amount"
              value={item.discount_amount}
              onChange={updateItem}
              onKeyDown={handleKeyDown}
              type="number"
            />
          ),
        },
        {
          key: "tax_amount",
          label: "Tax",
          size: "sm" as const,
          render: (item: TransactionLineItem) => (
            <ItemInput
              idPrefix={idPrefix}
              index={items.indexOf(item)}
              field="tax_amount"
              value={item.tax_amount}
              onChange={updateItem}
              onKeyDown={handleKeyDown}
              type="number"
            />
          ),
        },
        ]
      : []),
    {
      key: "line_total",
      label: "Total",
      align: "right",
      size: "sm",
      render: (item: TransactionLineItem) => (
        <span className="text-sm font-medium tabular-nums text-copy-primary">
          {formatTransactionMoney(transactionLineTotal(item), currency)}
        </span>
      ),
    },
  ];

  return (
    <FormSection
      title="Line items"
      description="Press Enter in a cell to move to the same field on the next row; Enter on the last row adds another item."
    >
      <RecordTable
        variant="lineItems"
        shellVariant="nested"
        label="Line items"
        columns={columns}
        rows={items}
        rowKey={(item) => item.key}
        rowActions={(item) => (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove ${item.name || `line ${items.indexOf(item) + 1}`}`}
            disabled={items.length === 1}
            onClick={() => onChange(items.filter((candidate) => candidate.key !== item.key))}
          >
            <Trash2 />
          </Button>
        )}
      />
      {error ? <p role="alert" className="mt-3 text-sm text-state-danger">{error}</p> : null}
      <Button type="button" variant="outline" className="mt-4" onClick={() => addItem()}>
        <Plus />Add line item
      </Button>
    </FormSection>
  );
}

function ItemInput({
  idPrefix,
  index,
  field,
  value,
  onChange,
  onKeyDown,
  type = "text",
  placeholder,
}: {
  idPrefix: string;
  index: number;
  field: ItemField;
  value: string;
  onChange: (index: number, field: ItemField, value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>, index: number, field: ItemField) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <Input
      {...{ [`data-${idPrefix}-row`]: index }}
      data-transaction-field={field}
      type={type}
      min={type === "number" ? "0" : undefined}
      step={type === "number" ? "0.01" : undefined}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(index, field, event.target.value)}
      onKeyDown={(event) => onKeyDown(event, index, field)}
      aria-label={`${field.replaceAll("_", " ")} line ${index + 1}`}
    />
  );
}
