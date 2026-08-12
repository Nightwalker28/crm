/**
 * The one Organization (Account) create/update contract.
 *
 * Quick Create and the canonical /new and /edit pages call the same domain endpoint with the
 * same payload shape and requiredness.
 */

import type { OrganizationFormValue } from "@/components/organizations/OrganizationFormFields";
import { pickEnabledModulePayload, type ModuleFieldConfig } from "@/hooks/useModuleFieldConfigs";
import { apiFetch } from "@/lib/api";

/** Fields the backend requires regardless of tenant module-field configuration. */
const ALWAYS_SUBMITTED_FIELDS = ["org_name", "primary_email", "custom_fields"];

export function validateOrganizationName(rawName: string): string | null {
  return rawName.trim() ? null : "Account name is required.";
}

export function validateOrganizationEmail(rawEmail: string): string | null {
  const email = rawEmail.trim();
  if (!email) return "Primary email is required.";
  if (!/^\S+@\S+\.\S+$/.test(email)) return "Enter a valid email address.";
  return null;
}

export function buildOrganizationPayload(
  form: OrganizationFormValue,
  customFieldValues: Record<string, unknown>,
  moduleFields: ModuleFieldConfig[],
  mode: "create" | "edit" = "create",
) {
  return pickEnabledModulePayload(
    {
      org_name: form.org_name.trim(),
      primary_email: form.primary_email.trim(),
      secondary_email: form.secondary_email.trim() || null,
      website: form.website.trim() || null,
      primary_phone: form.primary_phone.trim() || null,
      secondary_phone: form.secondary_phone.trim() || null,
      industry: form.industry.trim() || null,
      annual_revenue: form.annual_revenue.trim() || null,
      billing_address: form.billing_address.trim() || null,
      billing_city: form.billing_city.trim() || null,
      billing_state: form.billing_state.trim() || null,
      billing_postal_code: form.billing_postal_code.trim() || null,
      billing_country: form.billing_country || null,
      // An edit that clears the owner would otherwise reassign the account to the editor.
      assigned_to: mode === "edit" && form.assigned_to === null ? undefined : form.assigned_to,
      custom_fields: customFieldValues,
    },
    moduleFields,
    ALWAYS_SUBMITTED_FIELDS,
  );
}

export class OrganizationMutationError extends Error {
  readonly status: number;
  readonly detail: string | null;

  constructor(status: number, detail: string | null) {
    super(detail ?? `Failed with ${status}`);
    this.name = "OrganizationMutationError";
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

/** Writes an Organization. `apiFetch` never replays writes; retry is the caller's decision. */
export async function saveOrganization({
  mode,
  organizationId,
  payload,
}: {
  mode: "create" | "edit";
  organizationId?: string | number;
  payload: Record<string, unknown>;
}): Promise<number | null> {
  const endpoint = mode === "edit" ? `/sales/organizations/${organizationId}` : "/sales/organizations";
  const res = await apiFetch(endpoint, {
    method: mode === "edit" ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new OrganizationMutationError(res.status, errorDetail(body));
  if (mode === "edit") return organizationId === undefined ? null : Number(organizationId);
  const createdId = body && typeof body === "object" && "org_id" in body
    ? (body as { org_id: unknown }).org_id
    : null;
  return typeof createdId === "number" ? createdId : null;
}
