/**
 * Exact money arithmetic for line previews (13d §3.1, 13a A6). It mirrors the server's
 * `document_amounts.compute_line`: decimal values, each amount rounded half up to the cent,
 * so what a form shows is what the document saves. Amounts are integers of 1/10000 (four
 * places, the precision of quantities and prices) held in BigInt.
 */

// The target is ES2017, so no BigInt literals.
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const HUNDRED = BigInt(100);
const SCALE = BigInt(10000);
const CENT = HUNDRED; // 1/100 of a unit in 1/10000ths

/** "12.345" → 123450n; anything unreadable is 0. */
export function toUnits(value: string | number | null | undefined): bigint {
  const text = String(value ?? "").trim();
  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match || (!match[2] && !match[3])) return ZERO;
  const fraction = (match[3] ?? "").padEnd(5, "0");
  // Half up on a fifth decimal, so a typed "0.12345" reads as 0.1235.
  let units = BigInt(match[2] || "0") * SCALE + BigInt(fraction.slice(0, 4));
  if (Number(fraction[4]) >= 5) units += ONE;
  return match[1] ? -units : units;
}

/** Divide and round half up (away from zero), the server's ROUND_HALF_UP. */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = (numerator < ZERO) !== (denominator < ZERO);
  const n = numerator < ZERO ? -numerator : numerator;
  const d = denominator < ZERO ? -denominator : denominator;
  const result = (n * TWO + d) / (TWO * d);
  return negative ? -result : result;
}

/** Round 1/10000 units to whole cents (still in 1/10000 units). */
export function roundCents(units: bigint): bigint {
  return divideHalfUp(units, CENT) * CENT;
}

/** numerator ÷ denominator, in 1/10000 units, rounded once, straight to the cent. */
function centsOf(numerator: bigint, denominator: bigint): bigint {
  return divideHalfUp(numerator, denominator * CENT) * CENT;
}

export function unitsToNumber(units: bigint): number {
  return Number(units) / Number(SCALE);
}

export type LineAmounts = { gross: bigint; discount: bigint; net: bigint; tax: bigint; total: bigint };

/**
 * quantity × price − discount, with tax from `rate` (a percentage) or, when `rate` is null,
 * the typed `tax` kept as is. Inclusive prices contain the tax, which is taken out of the
 * line total; gross and discount are then before tax, as on the server.
 */
export function computeLine({
  quantity,
  unitPrice,
  discount = "0",
  rate = null,
  tax = "0",
  inclusive = false,
}: {
  quantity: string | number;
  unitPrice: string | number;
  discount?: string | number;
  rate?: string | number | null;
  tax?: string | number;
  inclusive?: boolean;
}): LineAmounts {
  const gross = centsOf(toUnits(quantity) * toUnits(unitPrice), SCALE);
  const lineDiscount = roundCents(toUnits(discount));
  const afterDiscount = gross - lineDiscount;
  const rateUnits = rate === null || rate === undefined || rate === "" ? null : toUnits(rate);
  if (!inclusive) {
    const lineTax = rateUnits === null ? roundCents(toUnits(tax)) : centsOf(afterDiscount * rateUnits, HUNDRED * SCALE);
    return { gross, discount: lineDiscount, net: afterDiscount, tax: lineTax, total: afterDiscount + lineTax };
  }
  let net: bigint;
  let lineTax: bigint;
  if (rateUnits === null) {
    lineTax = roundCents(toUnits(tax));
    net = afterDiscount - lineTax;
  } else {
    net = centsOf(afterDiscount * HUNDRED * SCALE, HUNDRED * SCALE + rateUnits);
    lineTax = afterDiscount - net;
  }
  const grossBeforeTax = afterDiscount > ZERO ? centsOf(gross * net, afterDiscount) : gross;
  return { gross: grossBeforeTax, discount: grossBeforeTax - net, net, tax: lineTax, total: afterDiscount };
}

/** `percent` per cent of an amount (both in 1/10000 units), straight to the cent. */
export function percentOf(units: bigint, percent: string | number): bigint {
  return centsOf(units * toUnits(percent), HUNDRED * SCALE);
}

export type DocumentTotals = { subtotal: number; discount: number; tax: number; total: number };

/** subtotal − discount + tax = total, as every document's header shows it. */
export function documentTotals(lines: LineAmounts[]): DocumentTotals {
  const sum = (pick: (line: LineAmounts) => bigint) => lines.reduce((result, line) => result + pick(line), ZERO);
  return {
    subtotal: unitsToNumber(sum((line) => line.gross)),
    discount: unitsToNumber(sum((line) => line.discount)),
    tax: unitsToNumber(sum((line) => line.tax)),
    total: unitsToNumber(sum((line) => line.total)),
  };
}
