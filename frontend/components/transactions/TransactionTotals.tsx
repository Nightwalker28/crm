"use client";

import { FormSection } from "@/components/forms/RecordFormLayout";
import { Money } from "@/components/ui/Money";
import { cn } from "@/lib/utils";

/**
 * A line-item document's money ledger (design.md §4.7, archetype 3).
 *
 * Quote, order and POS invoice each drew this block from a private `SummaryRow` copied
 * verbatim, and all three copies were wrong in the same place: the resolved figure was
 * `text-base font-semibold`, the 16px step §3.3 removed from the ramp. A total is the
 * **value** role at `font-semibold` — same size as the rows above it, heavier, and
 * `tabular-nums` so a column of figures lines up (§3.4).
 *
 * The ledger owns the sign too. `− $10.00` was being assembled at three call sites by
 * prepending a character to a formatted string, which made the sign a property of the
 * sentence rather than of the row.
 */
export type TransactionTotalsRow = {
  label: string;
  amount: number;
  /** A subtraction — the ledger draws the sign, the call site passes the magnitude. */
  negative?: boolean;
  /** The figure the operator acts on. Draws the rule above it and takes the value weight. */
  resolved?: boolean;
};

export function TransactionTotals({
  title = "Totals",
  description,
  rows,
  currency,
}: {
  /**
   * `Totals` on all three documents, because that is what the record layout has called this
   * exact field set since the layouts were seeded (§1.6). It stays a prop only so a fourth
   * document with a different name does not have to fork the primitive.
   */
  title?: string;
  description?: string;
  rows: TransactionTotalsRow[];
  currency: string;
}) {
  return (
    <FormSection title={title} description={description}>
      <dl data-slot="transaction-totals" className="space-y-3">
        {rows.map((row) => (
          <div
            key={row.label}
            className={cn(
              "flex items-center justify-between gap-3 text-sm",
              // No `mt-*`: the `dl`'s own `space-y-3` is the gap above the rule, which is
              // the rhythm the three private copies had.
              row.resolved
                ? "border-t border-line-default pt-3 font-semibold text-copy-primary"
                : "text-copy-secondary",
            )}
          >
            <dt>{row.label}</dt>
            {/* `tabular-nums` sits on the `dd` rather than only inside `Money`, so the
                minus column lines up with the figures it belongs to. */}
            <dd className="tabular-nums">
              {row.negative && row.amount !== 0 ? "− " : null}
              <Money amount={row.amount} currency={currency} />
            </dd>
          </div>
        ))}
      </dl>
    </FormSection>
  );
}
