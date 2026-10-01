/**
 * Which related sections of a record summary the reader may view
 * (05-relationships-data-model, Phase 4). A section set to `false` is hidden by
 * permission: its list is empty and its count is zero whatever exists, so it is not
 * drawn at all rather than shown as "none".
 */
export type RelatedRecordSection =
  | "contacts"
  | "opportunities"
  | "quotes"
  | "orders"
  | "invoices"
  | "insertion_orders";

export type RelatedRecordAccess = Partial<Record<RelatedRecordSection, boolean | null>>;

export function canViewRelated(
  access: RelatedRecordAccess | null | undefined,
  section: RelatedRecordSection,
): boolean {
  return access?.[section] !== false;
}
