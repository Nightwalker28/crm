"use client";

import { TaxSummary } from "@/components/finance/tax/TaxSummary";
import { Card } from "@/components/ui/Card";
import { Money } from "@/components/ui/Money";
import { RecordTable, type RecordRowId } from "@/components/ui/RecordTable";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { TextLink } from "@/components/ui/TextLink";
import type { TaxSummaryRow } from "@/hooks/finance/useTaxRates";
import { DASHBOARD_ROUTES } from "@/lib/routes";

/**
 * A line-item document's items, once saved (design.md §4.7 archetype 2, §7.10).
 *
 * Quote, order and POS invoice each drew this table by hand, and quote and order drew it
 * character for character — the same `SummaryRow` story `TransactionTotals` closed one
 * batch earlier, one level up. All three were also read-only, which is why they take
 * `variant="readOnly"` and not the `lineItems` variant the census predicted: the editable
 * grid is on the *form* page, behind `TransactionLineItemsEditor`, and there is exactly
 * one of those.
 *
 * The hand-rolled version wrapped the table in its own `overflow-x-auto` div. It does not
 * need one: `ModuleTableShell` is the scroll region, and `shellVariant="nested"` keeps it
 * from drawing a second panel edge one pixel inside the `Card`'s (§4.5).
 */
export type TransactionLineItemRow = {
  id: RecordRowId;
  /** The item's name. POS lines have only a description, and pass it here. */
  name: string;
  description?: string | null;
  quantity: number | string | null;
  unit_price: number | string | null;
  discount_amount?: number | string | null;
  tax_amount?: number | string | null;
  line_total: number | string | null;
  catalog_product_id?: number | null;
  catalog_service_id?: number | null;
  /** 13d §3.2: a section heading or note draws as text across the row. */
  line_type?: string | null;
  unit?: string | null;
  is_optional?: boolean | null;
};

const isItem = (item: TransactionLineItemRow) => !item.line_type || item.line_type === "item";

function catalogHref(item: TransactionLineItemRow) {
  if (item.catalog_product_id) return `${DASHBOARD_ROUTES.products}/${item.catalog_product_id}`;
  if (item.catalog_service_id) return `${DASHBOARD_ROUTES.services}/${item.catalog_service_id}`;
  return null;
}

export function TransactionLineItemsTable({
  items,
  currency,
  /** `Item` on a quote or order, `Description` on a POS invoice — the record layout's word. */
  itemLabel = "Item",
  /** POS lines carry no per-line discount or tax, so those two columns are not drawn. */
  showAdjustments = true,
  title = "Line items",
  /**
   * Link each catalog line to its product or service. CRM pages only: the client portal
   * draws the same table and its customers cannot open catalog records.
   */
  linkCatalogItems = false,
  /** The document's tax by rate (13d §3.1), drawn under the lines. */
  taxSummary,
  taxInclusive = false,
}: {
  items: TransactionLineItemRow[];
  /** Nullable because a document's currency is: `Money` renders the bare figure without one. */
  currency: string | null | undefined;
  itemLabel?: string;
  showAdjustments?: boolean;
  title?: string;
  linkCatalogItems?: boolean;
  taxSummary?: TaxSummaryRow[] | null;
  taxInclusive?: boolean;
}) {
  return (
    // `min-w-0` for the same reason `FormSection` carries it: this card is a grid item on
    // the record page, and without it the table's derived min-width stretches the content
    // column instead of scrolling inside it.
    <Card className="min-w-0 p-6">
      <SectionHeading>{title}</SectionHeading>
      <div className="mt-4">
        <RecordTable
          variant="readOnly"
          shellVariant="nested"
          label={title}
          rows={items}
          rowKey={(item) => item.id}
          emptyState={{ title: "This document has no line items" }}
          columns={[
            {
              key: "name",
              label: itemLabel,
              size: "lg",
              render: (item) => {
                if (item.line_type === "section") return <div className="font-semibold text-copy-primary">{item.name}</div>;
                if (item.line_type === "note") return <div className="whitespace-pre-line text-sm text-copy-secondary">{item.name}</div>;
                return (
                  <>
                    <div className="font-medium text-copy-primary">
                      {linkCatalogItems && catalogHref(item) ? (
                        <TextLink href={catalogHref(item) as string}>{item.name}</TextLink>
                      ) : item.name}
                      {item.is_optional ? <span className="ml-2 text-xs font-normal text-copy-muted">Optional</span> : null}
                    </div>
                    {item.description ? <div className="mt-1 text-xs text-copy-muted">{item.description}</div> : null}
                  </>
                );
              },
            },
            {
              key: "quantity",
              label: "Quantity",
              align: "right",
              size: "sm",
              render: (item) => (isItem(item) ? (
                <span className="tabular-nums text-copy-secondary">{Number(item.quantity ?? 0)}{item.unit ? ` ${item.unit}` : ""}</span>
              ) : null),
            },
            {
              key: "unit_price",
              label: "Unit price",
              align: "right",
              render: (item) => (isItem(item) ? <Money amount={item.unit_price} currency={currency} className="text-copy-secondary" /> : null),
            },
            ...(showAdjustments
              ? ([
                  {
                    key: "discount_amount",
                    label: "Discount",
                    align: "right" as const,
                    render: (item: TransactionLineItemRow) => (isItem(item) ? (
                      <Money amount={item.discount_amount} currency={currency} className="text-copy-secondary" />
                    ) : null),
                  },
                  {
                    key: "tax_amount",
                    label: "Tax",
                    align: "right" as const,
                    render: (item: TransactionLineItemRow) => (isItem(item) ? (
                      <Money amount={item.tax_amount} currency={currency} className="text-copy-secondary" />
                    ) : null),
                  },
                ])
              : []),
            {
              key: "line_total",
              label: "Total",
              align: "right",
              render: (item) => (isItem(item) ? (
                <Money amount={item.line_total} currency={currency} className={item.is_optional ? "text-copy-muted" : "font-medium text-copy-primary"} />
              ) : null),
            },
          ]}
        />
      </div>
      {taxSummary?.length ? (
        <div className="mt-4">
          <TaxSummary rows={taxSummary} currency={currency} inclusive={taxInclusive} />
        </div>
      ) : null}
    </Card>
  );
}
