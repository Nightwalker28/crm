import { apiFetch } from "@/lib/api";

export type MessageTemplate = {
  id: number;
  template_key: string;
  name: string;
  description: string | null;
  channel: string;
  module_key: string | null;
  body: string;
  variables: string[];
  is_system: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type TemplateDraft = {
  name: string;
  description: string;
  channel: string;
  module_key: string;
  body: string;
  variables: string;
  is_active: boolean;
};

export const CHANNEL_OPTIONS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "mail", label: "Mail" },
] as const;

export const MODULE_OPTIONS = [
  "sales_leads",
  "sales_contacts",
  "sales_organizations",
  "sales_opportunities",
  "sales_quotes",
  "tasks",
] as const;

export const VARIABLE_LIBRARY: Record<string, string[]> = {
  common: ["company_name", "sender_name", "meeting_date", "meeting_time", "next_step"],
  sales_leads: ["lead_name", "first_name", "last_name", "company", "primary_email", "phone", "source"],
  sales_contacts: ["customer_name", "first_name", "last_name", "primary_email", "phone", "organization_name"],
  sales_organizations: ["organization_name", "primary_email", "primary_phone", "website"],
  sales_opportunities: ["deal_name", "customer_name", "organization_name", "deal_value", "expected_close_date"],
  sales_quotes: ["quote_number", "customer_name", "organization_name", "total_amount", "expiry_date"],
  tasks: ["task_title", "due_at", "priority", "source_label"],
};

export const CRM_TEMPLATE_PRESETS = [
  { label: "Lead intro", channel: "mail", module_key: "sales_leads", name: "Lead intro", description: "First response to a new or qualified lead.", body: "Hi {{first_name}},\n\nThanks for reaching out to {{company_name}}. I wanted to introduce myself and learn a little more about what you are looking for.\n\nWould {{meeting_date}} work for a quick conversation?\n\nBest,\n{{sender_name}}" },
  { label: "Follow-up", channel: "whatsapp", module_key: "sales_contacts", name: "Follow-up", description: "General customer follow-up after a conversation.", body: "Hi {{first_name}}, following up on our last conversation. Please let me know if {{next_step}} still works for you." },
  { label: "Meeting request", channel: "mail", module_key: "sales_contacts", name: "Meeting request", description: "Request a meeting with a known contact.", body: "Hi {{first_name}},\n\nCan we schedule a meeting on {{meeting_date}} at {{meeting_time}} to discuss the next steps?\n\nBest,\n{{sender_name}}" },
  { label: "Quote follow-up", channel: "whatsapp", module_key: "sales_quotes", name: "Quote follow-up", description: "Follow up after sharing a quote.", body: "Hi {{customer_name}}, checking in on quote {{quote_number}} for {{total_amount}}. Please let us know if you have questions before {{expiry_date}}." },
  { label: "Deal negotiation", channel: "mail", module_key: "sales_opportunities", name: "Deal negotiation", description: "Continue a negotiation on an open deal.", body: "Hi {{customer_name}},\n\nFollowing up on {{deal_name}}. Based on our discussion, the next step is {{next_step}}.\n\nBest,\n{{sender_name}}" },
  { label: "Support handoff", channel: "mail", module_key: "sales_contacts", name: "Support handoff", description: "Hand a customer from sales to support or delivery.", body: "Hi {{first_name}},\n\nI am connecting you with our support team for {{next_step}}. They will have the context from our sales conversation.\n\nBest,\n{{sender_name}}" },
] as const;

export const EMPTY_TEMPLATE_DRAFT: TemplateDraft = {
  name: "",
  description: "",
  channel: "whatsapp",
  module_key: "sales_contacts",
  body: "",
  variables: "",
  is_active: true,
};

export function variablesToText(variables: string[]) {
  return variables.join(", ");
}

export function extractTemplateVariables(body: string) {
  return Array.from(body.matchAll(/{{\s*([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\s*}}/g))
    .map((match) => match[1])
    .filter(Boolean);
}

export function mergedTemplateVariables(body: string, variables: string) {
  const explicit = variables.split(",").map((item) => item.trim()).filter(Boolean);
  return Array.from(new Set([...explicit, ...extractTemplateVariables(body)])).sort();
}

export function templateToDraft(template: MessageTemplate): TemplateDraft {
  return {
    name: template.name,
    description: template.description ?? "",
    channel: template.channel,
    module_key: template.module_key ?? "sales_contacts",
    body: template.body,
    variables: variablesToText(template.variables),
    is_active: template.is_active,
  };
}

export async function fetchMessageTemplates(): Promise<MessageTemplate[]> {
  const res = await apiFetch("/message-templates?include_inactive=true");
  if (!res.ok) throw new Error("templates-load-failed");
  const body = await res.json().catch(() => null);
  return Array.isArray(body?.results) ? body.results : [];
}
