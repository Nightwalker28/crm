/**
 * The one Contact create/update contract.
 *
 * Quick Create, the contextual "+ Contact" surface, and the canonical /new and /edit pages
 * call the same domain endpoint with the same payload shape and requiredness. Anything a
 * surface needs to do differently belongs in that surface, not in a second copy of this file.
 */

import type { ContactFormValue } from "@/components/contacts/ContactFormFields";
import { pickEnabledModulePayload, type ModuleFieldConfig } from "@/hooks/useModuleFieldConfigs";
import { apiFetch } from "@/lib/api";

/** Fields the backend requires regardless of tenant module-field configuration. */
const ALWAYS_SUBMITTED_FIELDS = ["primary_email", "custom_fields"];

/**
 * Mirrors the backend's `primary_email is required` rule. Kept here so a surface cannot
 * invent a frontend-only requiredness that disagrees with the domain.
 */
export function validateContactEmail(rawEmail: string): string | null {
  const email = rawEmail.trim();
  if (!email) return "Email is required.";
  if (!/^\S+@\S+\.\S+$/.test(email)) return "Enter a valid email address.";
  return null;
}

export function buildContactPayload(
  form: ContactFormValue,
  customFieldValues: Record<string, unknown>,
  moduleFields: ModuleFieldConfig[],
  mode: "create" | "edit" = "create",
) {
  return pickEnabledModulePayload(
    {
      first_name: form.first_name.trim() || null,
      last_name: form.last_name.trim() || null,
      primary_email: form.primary_email.trim(),
      contact_telephone: form.contact_telephone.trim() || null,
      linkedin_url: form.linkedin_url.trim() || null,
      current_title: form.current_title.trim() || null,
      region: form.region || null,
      country: form.country || null,
      email_opt_out: form.email_opt_out,
      // An edit that clears the owner would otherwise reassign the contact to the editor.
      assigned_to: mode === "edit" && form.assigned_to === null ? undefined : form.assigned_to,
      organization_id: form.organization_id,
      custom_fields: customFieldValues,
    },
    moduleFields,
    ALWAYS_SUBMITTED_FIELDS,
  );
}

/**
 * Carries the backend status and `detail` so a caller can distinguish a duplicate contact, a
 * rejected cross-tenant account or owner, and a revoked link permission from a generic failure.
 */
export class ContactMutationError extends Error {
  readonly status: number;
  readonly detail: string | null;

  constructor(status: number, detail: string | null) {
    super(detail ?? `Failed with ${status}`);
    this.name = "ContactMutationError";
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
 * Writes a Contact. `apiFetch` never replays writes, so a caller that times out must decide
 * for itself whether to retry — this helper does not.
 */
export async function saveContact({
  mode,
  contactId,
  payload,
}: {
  mode: "create" | "edit";
  contactId?: string | number;
  payload: Record<string, unknown>;
}): Promise<number | null> {
  const endpoint = mode === "edit" ? `/sales/contacts/${contactId}` : "/sales/contacts";
  const res = await apiFetch(endpoint, {
    method: mode === "edit" ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ContactMutationError(res.status, errorDetail(body));
  if (mode === "edit") return contactId === undefined ? null : Number(contactId);
  const createdId = body && typeof body === "object" && "contact_id" in body
    ? (body as { contact_id: unknown }).contact_id
    : null;
  return typeof createdId === "number" ? createdId : null;
}
