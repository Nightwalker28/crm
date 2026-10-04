/**
 * A stock or line quantity, as people write it (13a H21).
 *
 * The API sends quantities as `NUMERIC(…, 4)` strings, so a list printed "83.0000 units".
 * Units carry no precision of their own yet, so the rule is the one every ERP list uses for
 * a count: no trailing zeros, at most four decimals, grouped thousands. Ten pages had their
 * own copy of this function; this is the one.
 */
export function formatQuantity(value: string | number | null | undefined): string {
  if (value == null || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

/** "83 units", "1 unit", "2.5 kg". The catalog's default unit is the word "unit". */
export function formatQuantityWithUnit(value: string | number | null | undefined, unit?: string | null): string {
  const formatted = formatQuantity(value);
  if (formatted === "—") return formatted;
  const name = (unit ?? "unit").trim() || "unit";
  const label = name === "unit" && Number(value) !== 1 ? "units" : name;
  return `${formatted} ${label}`;
}
