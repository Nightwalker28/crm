/**
 * The one Organization (Account) create/update contract.
 *
 * Quick Create and the canonical /new and /edit pages call the same domain endpoint with the
 * same payload shape and requiredness.
 */

import type { OrganizationFormValue } from "@/components/organizations/OrganizationFormFields";
import { addressFrom, addressPayload } from "@/components/forms/AddressFields";
import { pickEnabledModulePayload, type ModuleFieldConfig } from "@/hooks/useModuleFieldConfigs";
import { apiFetch } from "@/lib/api";
import { RecordMutationError } from "@/lib/apiErrors";

/** Fields the backend requires regardless of tenant module-field configuration. */
const ALWAYS_SUBMITTED_FIELDS = ["org_name", "primary_email", "custom_fields", "is_vendor", "payment_terms_days"];

export function validateOrganizationName(rawName: string): string | null {
  return rawName.trim() ? null : "Account name is required.";
}

/** Optional, as the domain has it; an email that is given must look like one. */
export function validateOrganizationEmail(rawEmail: string): string | null {
  const email = rawEmail.trim();
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return "Enter a valid email address.";
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
      primary_email: form.primary_email.trim() || null,
      secondary_email: form.secondary_email.trim() || null,
      website: form.website.trim() || null,
      primary_phone: form.primary_phone.trim() || null,
      secondary_phone: form.secondary_phone.trim() || null,
      industry: form.industry.trim() || null,
      account_type: form.account_type || null,
      annual_revenue: form.annual_revenue.trim() || null,
      employee_count: form.employee_count.trim() === "" ? null : Math.max(0, Math.round(Number(form.employee_count)) || 0),
      ...addressPayload("billing", addressFrom(form, "billing")),
      ...addressPayload("shipping", addressFrom(form, "shipping")),
      is_vendor: form.is_vendor,
      payment_terms_days: form.payment_terms_days.trim() === "" ? null : Math.max(0, Math.min(365, Math.round(Number(form.payment_terms_days)) || 0)),
      // An edit that clears the owner would otherwise reassign the account to the editor.
      assigned_to: mode === "edit" && form.assigned_to === null ? undefined : form.assigned_to,
      custom_fields: customFieldValues,
    },
    moduleFields,
    ALWAYS_SUBMITTED_FIELDS,
  );
}

export class OrganizationMutationError extends RecordMutationError {
  constructor(status: number, body: unknown) {
    super(status, body, "The account could not be saved.");
    this.name = "OrganizationMutationError";
  }
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
  if (!res.ok) throw new OrganizationMutationError(res.status, body);
  if (mode === "edit") return organizationId === undefined ? null : Number(organizationId);
  const createdId = body && typeof body === "object" && "org_id" in body
    ? (body as { org_id: unknown }).org_id
    : null;
  return typeof createdId === "number" ? createdId : null;
}
