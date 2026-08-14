"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";

import { ContactFormMainFields, ContactFormSidebarFields, EMPTY_CONTACT_FORM, type ContactFormValue } from "@/components/contacts/ContactFormFields";
import { buildContactPayload, saveContact, validateContactEmail } from "@/components/contacts/contactMutation";
import {
  consumeContactQuickCreateDraft,
  isContactQuickCreateHandoff,
} from "@/components/contacts/contactQuickCreateDraft";
import { RecordFormLayout } from "@/components/forms/RecordFormLayout";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/ui/PageShell";
import { RouteErrorState, RouteLoadingState } from "@/components/ui/RouteStates";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";

type ContactSummary = {
  contact: ContactFormValue & { contact_id: number; custom_fields?: Record<string, unknown> | null; updated_at?: string | null };
  organization?: { org_id: number; org_name: string } | null;
};

async function fetchContactSummary(contactId: string) {
  const res = await apiFetch(`/sales/contacts/${contactId}/summary`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
  return body as ContactSummary;
}

export default function ContactRecordFormPage({ mode, contactId }: { mode: "create" | "edit"; contactId?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ContactFormValue>(EMPTY_CONTACT_FORM);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});
  const [initialSnapshot, setInitialSnapshot] = useState(() => JSON.stringify([EMPTY_CONTACT_FORM, {}]));
  const [emailError, setEmailError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const customFieldsQuery = useModuleCustomFields("sales_contacts", true);
  const { fields: moduleFields } = useModuleFieldConfigs("sales_contacts");
  const summaryQuery = useQuery({
    queryKey: ["sales-contact-summary", contactId],
    queryFn: () => fetchContactSummary(contactId as string),
    enabled: mode === "edit" && Boolean(contactId),
    refetchOnWindowFocus: false,
  });

  // Picks up values handed off from Quick Create's "More details". The initial snapshot stays
  // empty on purpose, so the restored values count as unsaved changes and stay guarded.
  useEffect(() => {
    if (mode !== "create" || !isContactQuickCreateHandoff(window.location.search)) return;
    const draft = consumeContactQuickCreateDraft();
    if (!draft) return;
    setForm(draft.form);
    setCustomFieldValues(draft.customFieldValues);
  }, [mode]);

  useEffect(() => {
    if (mode !== "edit" || !summaryQuery.data) return;
    const contact = summaryQuery.data.contact;
    const nextForm: ContactFormValue = {
      first_name: contact.first_name ?? "",
      last_name: contact.last_name ?? "",
      primary_email: contact.primary_email ?? "",
      contact_telephone: contact.contact_telephone ?? "",
      linkedin_url: contact.linkedin_url ?? "",
      current_title: contact.current_title ?? "",
      region: contact.region ?? "",
      country: contact.country ?? "",
      email_opt_out: Boolean(contact.email_opt_out),
      organization_id: contact.organization_id ?? null,
      organization_name: summaryQuery.data.organization?.org_name ?? "",
      assigned_to: contact.assigned_to ?? null,
      assigned_to_name: contact.assigned_to_name ?? "",
    };
    const nextCustomFields = contact.custom_fields ?? {};
    setForm(nextForm);
    setCustomFieldValues(nextCustomFields);
    setInitialSnapshot(JSON.stringify([nextForm, nextCustomFields]));
  }, [mode, summaryQuery.data]);

  const currentSnapshot = useMemo(() => JSON.stringify([form, customFieldValues]), [form, customFieldValues]);
  const isDirty = currentSnapshot !== initialSnapshot;

  useUnsavedChangesGuard(isDirty, submitting);

  function validate() {
    const error = validateContactEmail(form.primary_email);
    setEmailError(error);
    if (error) {
      document.getElementById("contact-primary-email")?.focus();
      return false;
    }
    return true;
  }

  async function submit() {
    if (!validate()) return;
    try {
      setSubmitting(true);
      setSubmitError(null);
      const savedContactId = await saveContact({
        mode,
        contactId,
        payload: buildContactPayload(form, customFieldValues, moduleFields, mode),
      });
      await queryClient.invalidateQueries({ queryKey: ["sales-contacts"] });
      if (savedContactId) await queryClient.invalidateQueries({ queryKey: ["sales-contact-summary", String(savedContactId)] });
      setInitialSnapshot(currentSnapshot);
      toast.success(mode === "edit" ? "Contact updated." : "Contact created.");
      router.push(savedContactId ? `/dashboard/sales/contacts/${savedContactId}` : "/dashboard/sales/contacts");
    } catch {
      setSubmitError(mode === "edit" ? "The contact could not be updated. Check the fields and try again." : "The contact could not be created. Check the fields and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (mode === "edit" && summaryQuery.isLoading) return <RouteLoadingState label="contact" />;
  if (mode === "edit" && summaryQuery.error) {
    return <RouteErrorState title="Unable to load this contact" reset={() => void summaryQuery.refetch()} backHref="/dashboard/sales/contacts" backLabel="Back to contacts" />;
  }

  const title = mode === "edit" ? "Edit contact" : "Create contact";
  const cancelHref = mode === "edit" && contactId ? `/dashboard/sales/contacts/${contactId}` : "/dashboard/sales/contacts";
  return (
    <PageShell
      title={title}
      eyebrow={mode === "edit" && summaryQuery.data?.contact.updated_at ? `Last modified ${formatDateTime(summaryQuery.data.contact.updated_at)}` : undefined}
      description={mode === "edit" ? "Update contact details, ownership, and account information." : "Add a person and connect them to the right account and owner."}
      actions={<Button asChild variant="ghost" size="sm"><Link href={cancelHref}><ArrowLeft />Back to {mode === "edit" ? "contact" : "contacts"}</Link></Button>}
    >
      {submitError ? <div role="alert" className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary"><div className="font-medium">We could not save this contact.</div><div className="mt-1 text-copy-secondary">{submitError}</div></div> : null}
      <RecordFormLayout
        sidebar={<ContactFormSidebarFields value={form} onChange={setForm} moduleFields={moduleFields} mode={mode} />}
        footer={<div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm text-copy-muted">{isDirty ? "You have unsaved changes." : mode === "edit" ? "No unsaved changes." : "Complete the required fields to create this contact."}</span><div className="flex items-center gap-2"><Button asChild variant="outline"><Link href={cancelHref}>Cancel</Link></Button><Button onClick={() => void submit()} disabled={submitting || (mode === "edit" && !isDirty)}><Save />{submitting ? "Saving…" : mode === "edit" ? "Save changes" : "Create contact"}</Button></div></div>}
      >
        <ContactFormMainFields
          value={form}
          onChange={setForm}
          customFields={customFieldsQuery.data ?? []}
          customFieldValues={customFieldValues}
          onCustomFieldChange={(fieldKey, value) => setCustomFieldValues((current) => ({ ...current, [fieldKey]: value }))}
          moduleFields={moduleFields}
          emailError={emailError}
          mode={mode}
        />
      </RecordFormLayout>
    </PageShell>
  );
}
