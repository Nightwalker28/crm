/**
 * The single money formatter.
 *
 * Dates were centralised in `lib/datetime.ts`; money never was, so 15 local formatters and
 * 24 raw `Intl.NumberFormat` call sites accumulated — half on `"en-US"`, half on `undefined`
 * (the browser locale). That mix means the same invoice total renders `$1,234.50` for one
 * operator and `1.234,50 $` for another, in a product whose dates are already pinned to
 * `en-US`. See docs/design/rebuild.md 5.1.
 *
 * The locale is pinned here for the same reason `datetime.ts` pins it: a tenant's records are
 * one document set, and half of it following the browser while the other half does not is the
 * inconsistency, not the fix.
 *
 * Formatters are cached. `Intl.NumberFormat` construction is the expensive part — a 50-row
 * money column built one formatter per cell per render.
 */

const LOCALE = "en-US";

export const DEFAULT_CURRENCY = "USD";

type MoneyFormatOptions = {
  /** Drop the minor units — for dashboard figures and compact totals. */
  maximumFractionDigits?: number;
  minimumFractionDigits?: number;
  /** `$1.2M` rather than `$1,200,000.00`. Dashboard stat figures only. */
  compact?: boolean;
};

const formatterCache = new Map<string, Intl.NumberFormat>();

function getFormatter(currency: string, options: MoneyFormatOptions): Intl.NumberFormat {
  const key = `${currency}|${options.compact ? "c" : ""}|${options.minimumFractionDigits ?? ""}|${options.maximumFractionDigits ?? ""}`;
  const cached = formatterCache.get(key);
  if (cached) return cached;

  const formatter = new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    ...(options.compact ? { notation: "compact" as const, maximumFractionDigits: 1 } : null),
    ...(options.minimumFractionDigits === undefined
      ? null
      : { minimumFractionDigits: options.minimumFractionDigits }),
    ...(options.maximumFractionDigits === undefined
      ? null
      : { maximumFractionDigits: options.maximumFractionDigits }),
  });

  formatterCache.set(key, formatter);
  return formatter;
}

/**
 * `null` / `undefined` / non-finite return `null` rather than a placeholder string, so the
 * *renderer* decides between `Not set` and `—` (design.md 3.6). A formatter that invented its
 * own empty string is how six spellings of "absent" got into the app.
 */
export function formatMoney(
  amount: number | string | null | undefined,
  currency?: string | null,
  options: MoneyFormatOptions = {},
): string | null {
  const value = typeof amount === "string" ? Number(amount) : amount;
  if (value === null || value === undefined || !Number.isFinite(value)) return null;

  const code = (currency || DEFAULT_CURRENCY).toUpperCase();

  try {
    return getFormatter(code, options).format(value);
  } catch {
    // An unknown or malformed ISO code throws in the constructor. Show the number with the
    // code beside it rather than dropping the amount the operator came for.
    return `${code} ${value.toFixed(options.maximumFractionDigits ?? 2)}`;
  }
}

/** `$1.2M`. Dashboard stat figures and compact pipeline totals only. */
export function formatMoneyCompact(
  amount: number | string | null | undefined,
  currency?: string | null,
): string | null {
  return formatMoney(amount, currency, { compact: true });
}
