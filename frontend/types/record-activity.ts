export type RecordModuleKey = "sales_leads" | "sales_contacts" | "sales_organizations" | "sales_opportunities" | "sales_quotes";

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
