/**
 * The one Lead create/update contract.
 *
 * Quick Create and the canonical /new and /edit pages call the same domain endpoint with the
 * same payload shape, requiredness, and datetime handling. Anything a surface needs to do
 * differently belongs in that surface, not in a second copy of this file — the roadmap risk
 * this guards against is "duplicate form logic between quick and full surfaces".
 */

import type { LeadFormValue } from "@/components/leads/LeadFormFields";
import { pickEnabledModulePayload, type ModuleFieldConfig } from "@/hooks/useModuleFieldConfigs";
import { apiFetch } from "@/lib/api";

/** Fields the backend requires regardless of tenant module-field configuration. */
const ALWAYS_SUBMITTED_FIELDS = ["primary_email", "custom_fields"];

export function toDatetimeLocalValue(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

export function toIsoOrNull(value: string) {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Mirrors the backend's `primary_email is required` rule. Kept here so a surface cannot
 * invent a frontend-only requiredness that disagrees with the domain.
 */
export function validateLeadEmail(rawEmail: string): string | null {
  const email = rawEmail.trim();
  if (!email) return "Email is required.";
  if (!/^\S+@\S+\.\S+$/.test(email)) return "Enter a valid email address.";
  return null;
}

export function buildLeadPayload(
  form: LeadFormValue,
  customFieldValues: Record<string, unknown>,
  moduleFields: ModuleFieldConfig[],
) {
  return pickEnabledModulePayload(
    {
      first_name: form.first_name.trim() || null,
      last_name: form.last_name.trim() || null,
      company: form.company.trim() || null,
      primary_email: form.primary_email.trim(),
      phone: form.phone.trim() || null,
      title: form.title.trim() || null,
      source: form.source.trim() || null,
      status: form.status,
      notes: form.notes.trim() || null,
      assigned_to: form.assigned_to,
      next_follow_up_at: toIsoOrNull(form.next_follow_up_at),
      team_id: form.team_id,
      tags: form.tags,
      custom_fields: customFieldValues,
    },
    moduleFields,
    ALWAYS_SUBMITTED_FIELDS,
  );
}

/**
 * Carries the backend status and `detail` so a caller can distinguish a duplicate-email
 * conflict, a rejected cross-tenant owner/team, and revoked permission from a generic failure.
 */
export class LeadMutationError extends Error {
  readonly status: number;
  readonly detail: string | null;

  constructor(status: number, detail: string | null) {
    super(detail ?? `Failed with ${status}`);
    this.name = "LeadMutationError";
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

/**
 * Writes a Lead. `apiFetch` never replays writes, so a caller that times out must decide
 * for itself whether to retry — this helper does not.
 */
export async function saveLead({
  mode,
  leadId,
  payload,
}: {
  mode: "create" | "edit";
  leadId?: string | number;
  payload: Record<string, unknown>;
}): Promise<number | null> {
  const endpoint = mode === "edit" ? `/sales/leads/${leadId}` : "/sales/leads";
  const res = await apiFetch(endpoint, {
    method: mode === "edit" ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new LeadMutationError(res.status, errorDetail(body));
  if (mode === "edit") return leadId === undefined ? null : Number(leadId);
  const createdId = body && typeof body === "object" && "lead_id" in body ? (body as { lead_id: unknown }).lead_id : null;
  return typeof createdId === "number" ? createdId : null;
}
