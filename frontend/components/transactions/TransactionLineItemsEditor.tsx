"use client";

import LinkedRecordPicker, { type LinkedRecordOption } from "@/components/crm/LinkedRecordPicker";
import { FormSection } from "@/components/forms/RecordFormLayout";
import { LineItemsEditor, LineNumberInput, LineTextInput, type LineItemsColumn } from "@/components/transactions/LineItemsEditor";
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
    render: (item, { index, cellProps }) => (
      <LineNumberInput
        cellProps={cellProps(field)}
        value={item[field]}
        onChange={(value) => updateItem(index, field, value)}
        ariaLabel={`${field.replaceAll("_", " ")} line ${index + 1}`}
      />
    ),
  });

  const columns: LineItemsColumn<TransactionLineItem>[] = [
    {
      key: "name",
      label: itemLabel,
      size: "lg",
      share: 4,
      render: (item, { index, cellProps }) => {
        const nameCell = cellProps("name");
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
        if (!showDescription) return name;
        return (
          <div className="flex min-w-0 flex-col gap-1.5">
            {name}
            <LineTextInput
              cellProps={cellProps("description")}
              value={item.description}
              onChange={(value) => updateItem(index, "description", value)}
              ariaLabel={`description line ${index + 1}`}
              placeholder="Description (optional)"
            />
          </div>
        );
      },
    },
    amount("quantity", "Qty", 1),
    amount("unit_price", "Unit price", 1.5),
    ...(showAdjustments ? [amount("discount_amount", "Discount", 1.25), amount("tax_amount", "Tax", 1.25)] : []),
    {
      key: "line_total",
      label: "Total",
      align: "right",
      size: "sm",
      share: 1.5,
      render: (item) => (
        <span className="block truncate text-sm font-medium tabular-nums text-copy-primary">
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
      <LineItemsEditor
        id={idPrefix}
        label="Line items"
        lines={items}
        lineKey={(item) => item.key}
        columns={columns}
        onChange={onChange}
        createLine={() => createTransactionLineItem(idPrefix)}
        addLabel="Add line item"
        lineLabel={(item, index) => item.name || `line ${index + 1}`}
        error={error}
      />
    </FormSection>
  );
}
