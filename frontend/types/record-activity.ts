export type RecordModuleKey =
  | "sales_leads"
  | "sales_contacts"
  | "sales_organizations"
  | "sales_opportunities"
  | "sales_quotes"
  | "sales_orders"
  | "support_cases"
  | "finance_io"
  | "finance_pos"
  | "catalog_products"
  | "catalog_services";

export type ActivityItem = {
  id: number;
  actor_user_id?: number | null;
  module_key: string;
  entity_type: string;
  entity_id: string;
  action: string;
  description?: string | null;
  created_at: string;
};

/**
 * Relationship activity — the salesperson-facing interaction feed.
 *
 * `ActivityItem` above is the *audit* log shape served by `/activity/record`.
 * The two are deliberately separate surfaces; do not merge them.
 */
export const RECORD_ACTIVITY_TYPES = [
  "email",
  "follow_up",
  "meeting",
  "note",
  "task",
  "whatsapp",
] as const;

export type RecordActivityType = (typeof RECORD_ACTIVITY_TYPES)[number];

export type RecordActivityActor = {
  user_id: number | null;
  name: string | null;
};

export type RecordActivityEnvelope = {
  id: string;
  type: RecordActivityType;
  occurred_at: string;
  title: string;
  summary: string | null;
  direction: string | null;
  status: string | null;
  actor: RecordActivityActor | null;
  source: { module_key: string; record_id: string };
  record: { module_key: string; entity_id: string };
  capabilities: string[];
  meta: Record<string, unknown>;
};

export type RecordActivityPage = {
  items: RecordActivityEnvelope[];
  next_cursor: string | null;
  has_more: boolean;
  limit: number;
  available_types: RecordActivityType[];
  omitted_types: RecordActivityType[];
};

export type CommentItem = {
  id: number;
  actor_user_id?: number | null;
  module_key: string;
  entity_id: string;
  body: string;
  author_name: string;
  created_at: string;
  updated_at: string;
};
