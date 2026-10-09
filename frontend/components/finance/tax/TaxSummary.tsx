"use client";

import { Money } from "@/components/ui/Money";
import type { TaxSummaryRow } from "@/hooks/finance/useTaxRates";

/**
 * A document's tax by rate (13d §3.1): the taxable amount and the tax per rate, a group drawn
 * as its components. Nothing is drawn when the document carries no tax.
 */
export function TaxSummary({
  rows,
  currency,
  inclusive = false,
}: {
  rows: TaxSummaryRow[] | null | undefined;
  currency: string | null | undefined;
  inclusive?: boolean;
}) {
  if (!rows?.length) return null;
  return (
    <section aria-label="Tax summary" className="ml-auto w-full max-w-md">
      <h3 className="text-sm font-semibold text-copy-primary">
        Tax summary{inclusive ? <span className="font-normal text-copy-muted"> · prices include tax</span> : null}
      </h3>
      <dl className="mt-2 grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1 text-sm">
        <dt className="text-xs text-copy-muted">Rate</dt>
        <dd className="text-right text-xs text-copy-muted">Taxable</dd>
        <dd className="text-right text-xs text-copy-muted">Tax</dd>
        {rows.map((row) => (
          <div key={`${row.tax_rate_id ?? "none"}-${row.name}`} className="contents">
            <dt className="truncate text-copy-secondary">
              {row.name}
              {row.group ? <span className="text-copy-muted"> ({row.group})</span> : null}
            </dt>
            <dd className="text-right">
              <Money amount={row.taxable} currency={currency} className="text-copy-secondary" />
            </dd>
            <dd className="text-right">
              <Money amount={row.tax} currency={currency} className="font-medium text-copy-primary" />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
