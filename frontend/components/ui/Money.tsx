import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/currency";
import { EmptyValue, type EmptyValueContext } from "@/components/ui/EmptyValue";

type MoneyProps = {
  amount: number | string | null | undefined;
  currency?: string | null;
  /** Decides the empty spelling only — `Not set` in a field, `—` in a cell (design.md 3.6). */
  context?: EmptyValueContext;
  /** `$1.2M`. Dashboard stat figures and compact pipeline totals only. */
  compact?: boolean;
  maximumFractionDigits?: number;
  minimumFractionDigits?: number;
  className?: string;
};

/**
 * Money, rendered.
 *
 * It owns **formatting and figure shape**, not ink or size. A total is `text-copy-primary` in
 * a record's Commercial block and `text-copy-secondary` in a table cell (3.3) — that is the
 * surrounding role's decision, so `Money` inherits it rather than fighting it. What it always
 * owns is `tabular-nums`: money is compared down a column, and proportional digits make a
 * column of totals ragged (3.2).
 */
export function Money({
  amount,
  currency,
  context = "cell",
  compact,
  maximumFractionDigits,
  minimumFractionDigits,
  className,
}: MoneyProps) {
  const formatted = formatMoney(amount, currency, {
    compact,
    maximumFractionDigits,
    minimumFractionDigits,
  });

  if (formatted === null) return <EmptyValue context={context} />;

  return <span data-slot="money" className={cn("tabular-nums", className)}>{formatted}</span>;
}
