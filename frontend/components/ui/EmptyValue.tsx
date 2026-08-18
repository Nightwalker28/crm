/**
 * The absent value, in one place.
 *
 * design.md 3.6 rules that there is one answer per context and **no call site chooses it**:
 * a field on a record reads `Not set`, a cell in a table reads `—`. Six spellings were in the
 * app when that rule was written, and `ReadOnlyRecordLayout` — the primitive three pages share
 * — emitted the one nobody else used.
 *
 * The strings live here so the copy sweep in rebuild.md 5.9 is one edit rather than 120.
 */

export const EMPTY_FIELD_VALUE = "Not set";
export const EMPTY_CELL_VALUE = "—";

export type EmptyValueContext = "field" | "cell";

export function emptyValueFor(context: EmptyValueContext) {
  return context === "field" ? EMPTY_FIELD_VALUE : EMPTY_CELL_VALUE;
}

/**
 * Muted, because an absent value is metadata about the record rather than content of it
 * (3.3). It is never `text-copy-disabled` — the operator can act on this field, it simply
 * has no value yet (2.1).
 */
export function EmptyValue({ context = "cell" }: { context?: EmptyValueContext }) {
  return <span data-slot="empty-value" className="text-copy-muted">{emptyValueFor(context)}</span>;
}
