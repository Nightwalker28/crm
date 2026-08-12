/**
 * The one Opportunity (Deal) create/update contract.
 *
 * The contextual "+ Deal" Quick Create opened from a Contact or Account and the canonical
 * /new and /edit pages post the same payload shape to the same endpoint. Quick Create simply
 * renders fewer of the fields; the ones it does not show stay at their empty defaults.
 */

import type { OpportunityFormValue } from "@/components/opportunities/OpportunityFormFields";
import { pickEnabledModulePayload, type ModuleFieldConfig } from "@/hooks/useModuleFieldConfigs";
import { apiFetch } from "@/lib/api";

/** Fields the backend requires regardless of tenant module-field configuration. */
const ALWAYS_SUBMITTED_FIELDS = ["opportunity_name", "contact_id", "custom_fields"];

export function validateOpportunityName(rawName: string): string | null {
  return rawName.trim() ? null : "Deal name is required.";
}

export function validateOpportunityContact(contactId: number | null): string | null {
  return contactId ? null : "Select an existing contact.";
}

export function buildOpportunityPayload(
  form: OpportunityFormValue,
  customFieldValues: Record<string, unknown>,
  moduleFields: ModuleFieldConfig[],
  mode: "create" | "edit" = "create",
) {
  const trim = (value: string) => value.trim() || null;
  return pickEnabledModulePayload(
    {
      opportunity_name: form.opportunity_name.trim(),
      // `client` is the denormalized contact name the domain keeps alongside the link.
      client: form.contact_name.trim(),
      contact_id: form.contact_id,
      organization_id: form.organization_id,
      // An edit that clears the owner would otherwise reassign the deal to the editor.
      assigned_to: mode === "edit" && form.assigned_to === null ? undefined : form.assigned_to,
      sales_stage: form.sales_stage || "lead",
      start_date: form.start_date || null,
      expected_close_date: form.expected_close_date || null,
      probability_percent: form.probability_percent.trim() ? Number(form.probability_percent) : null,
      total_cost_of_project: trim(form.total_cost_of_project),
      currency_type: form.currency_type || null,
      campaign_type: trim(form.campaign_type),
      total_leads: trim(form.total_leads),
      cpl: trim(form.cpl),
      target_geography: trim(form.target_geography),
      target_audience: trim(form.target_audience),
      domain_cap: trim(form.domain_cap),
      tactics: trim(form.tactics),
      delivery_format: trim(form.delivery_format),
      attachments: form.attachments,
      custom_fields: customFieldValues,
    },
    moduleFields,
    ALWAYS_SUBMITTED_FIELDS,
  );
}

export class OpportunityMutationError extends Error {
  readonly status: number;
  readonly detail: string | null;

  constructor(status: number, detail: string | null) {
    super(detail ?? `Failed with ${status}`);
    this.name = "OpportunityMutationError";
    this.status = status;
    this.detail = detail;
  }
}

function errorDetail(body: unknown) {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
  }
  return null;
}

/** Writes an Opportunity. `apiFetch` never replays writes; retry is the caller's decision. */
export async function saveOpportunity({
  mode,
  opportunityId,
  payload,
}: {
  mode: "create" | "edit";
  opportunityId?: string | number;
  payload: Record<string, unknown>;
}): Promise<number | null> {
  const endpoint = mode === "edit" ? `/sales/opportunities/${opportunityId}` : "/sales/opportunities";
  const res = await apiFetch(endpoint, {
    method: mode === "edit" ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new OpportunityMutationError(res.status, errorDetail(body));
  if (mode === "edit") return opportunityId === undefined ? null : Number(opportunityId);
  const createdId = body && typeof body === "object" && "opportunity_id" in body
    ? (body as { opportunity_id: unknown }).opportunity_id
    : null;
  return typeof createdId === "number" ? createdId : null;
}
