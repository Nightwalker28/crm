"use client";

import { Card } from "@/components/ui/Card";
import { Money } from "@/components/ui/Money";
import { RecordTable, type RecordRowId } from "@/components/ui/RecordTable";
import { SectionHeading } from "@/components/ui/SectionHeading";

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
};

export function TransactionLineItemsTable({
  items,
  currency,
  /** `Item` on a quote or order, `Description` on a POS invoice — the record layout's word. */
  itemLabel = "Item",
  /** POS lines carry no per-line discount or tax, so those two columns are not drawn. */
  showAdjustments = true,
  title = "Line items",
}: {
  items: TransactionLineItemRow[];
  /** Nullable because a document's currency is: `Money` renders the bare figure without one. */
  currency: string | null | undefined;
  itemLabel?: string;
  showAdjustments?: boolean;
  title?: string;
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
              render: (item) => (
                <>
                  <div className="font-medium text-copy-primary">{item.name}</div>
                  {item.description ? <div className="mt-1 text-xs text-copy-muted">{item.description}</div> : null}
                </>
              ),
            },
            {
              key: "quantity",
              label: "Quantity",
              align: "right",
              size: "sm",
              render: (item) => (
                <span className="tabular-nums text-copy-secondary">{Number(item.quantity ?? 0)}</span>
              ),
            },
            {
              key: "unit_price",
              label: "Unit price",
              align: "right",
              render: (item) => <Money amount={item.unit_price} currency={currency} className="text-copy-secondary" />,
            },
            ...(showAdjustments
              ? ([
                  {
                    key: "discount_amount",
                    label: "Discount",
                    align: "right" as const,
                    render: (item: TransactionLineItemRow) => (
                      <Money amount={item.discount_amount} currency={currency} className="text-copy-secondary" />
                    ),
                  },
                  {
                    key: "tax_amount",
                    label: "Tax",
                    align: "right" as const,
                    render: (item: TransactionLineItemRow) => (
                      <Money amount={item.tax_amount} currency={currency} className="text-copy-secondary" />
                    ),
                  },
                ])
              : []),
            {
              key: "line_total",
              label: "Total",
              align: "right",
              render: (item) => (
                <Money amount={item.line_total} currency={currency} className="font-medium text-copy-primary" />
              ),
            },
          ]}
        />
      </div>
    </Card>
  );
}
