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
import { RecordMutationError } from "@/lib/apiErrors";

/** Fields the backend requires regardless of tenant module-field configuration. */
const ALWAYS_SUBMITTED_FIELDS = ["opportunity_name", "contact_id", "organization_id", "custom_fields"];

export function validateOpportunityName(rawName: string | null | undefined): string | null {
  return (rawName ?? "").trim() ? null : "Deal name is required.";
}

/** A deal belongs to an account, a contact, or both (13a H13). */
export function validateOpportunityParty(form: Pick<OpportunityFormValue, "contact_id" | "organization_id">): string | null {
  return form.contact_id || form.organization_id ? null : "Choose an account or a contact.";
}

export function buildOpportunityPayload(
  form: OpportunityFormValue,
  customFieldValues: Record<string, unknown>,
  moduleFields: ModuleFieldConfig[],
  mode: "create" | "edit" = "create",
  /** The pipeline's default stage (`defaultStageKey`), used when the form left Stage empty. */
  defaultStage = "",
) {
  // Null-safe: a field the record left empty may still be null here (13a H1).
  const text = (value: string | null | undefined) => (value ?? "").trim();
  const trim = (value: string | null | undefined) => text(value) || null;
  return pickEnabledModulePayload(
    {
      opportunity_name: text(form.opportunity_name),
      contact_id: form.contact_id,
      organization_id: form.organization_id,
      // An edit that clears the owner would otherwise reassign the deal to the editor.
      assigned_to: mode === "edit" && form.assigned_to === null ? undefined : form.assigned_to,
      sales_stage: form.sales_stage || defaultStage || null,
      start_date: form.start_date || null,
      expected_close_date: form.expected_close_date || null,
      probability_percent: text(form.probability_percent) ? Number(form.probability_percent) : null,
      amount: text(form.amount) ? text(form.amount) : null,
      currency_type: form.currency_type || null,
      deal_type: form.deal_type || null,
      source: form.source || null,
      next_step: trim(form.next_step),
      lost_reason: form.lost_reason || null,
      custom_fields: customFieldValues,
    },
    moduleFields,
    ALWAYS_SUBMITTED_FIELDS,
  );
}

export class OpportunityMutationError extends RecordMutationError {
  constructor(status: number, body: unknown) {
    super(status, body, "The deal could not be saved.");
    this.name = "OpportunityMutationError";
  }
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
  if (!res.ok) throw new OpportunityMutationError(res.status, body);
  if (mode === "edit") return opportunityId === undefined ? null : Number(opportunityId);
  const createdId = body && typeof body === "object" && "opportunity_id" in body
    ? (body as { opportunity_id: unknown }).opportunity_id
    : null;
  return typeof createdId === "number" ? createdId : null;
}
