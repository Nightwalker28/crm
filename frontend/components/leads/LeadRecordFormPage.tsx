"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";

import { RecordFormLayout } from "@/components/forms/RecordFormLayout";
import { EMPTY_LEAD_FORM, LeadFormMainFields, LeadFormSidebarFields, type LeadFormValue } from "@/components/leads/LeadFormFields";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { pickEnabledModulePayload, useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { apiFetch } from "@/lib/api";

type LeadSummary = {
  lead: LeadFormValue & {
    lead_id: number;
    custom_fields?: Record<string, unknown> | null;
  };
};

type LeadResponse = { lead_id: number };

async function fetchLeadSummary(leadId: string) {
  const res = await apiFetch(`/sales/leads/${leadId}/summary`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
  return body as LeadSummary;
}

export default function LeadRecordFormPage({ mode, leadId }: { mode: "create" | "edit"; leadId?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<LeadFormValue>(EMPTY_LEAD_FORM);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});
  const [initialSnapshot, setInitialSnapshot] = useState(() => JSON.stringify([EMPTY_LEAD_FORM, {}]));
  const [emailError, setEmailError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const customFieldsQuery = useModuleCustomFields("sales_leads", true);
  const { fields: moduleFields } = useModuleFieldConfigs("sales_leads");
  const summaryQuery = useQuery({
    queryKey: ["sales-lead-summary", leadId],
    queryFn: () => fetchLeadSummary(leadId as string),
    enabled: mode === "edit" && Boolean(leadId),
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (mode !== "edit" || !summaryQuery.data) return;
    const lead = summaryQuery.data.lead;
    const nextForm: LeadFormValue = {
      first_name: lead.first_name ?? "",
      last_name: lead.last_name ?? "",
      company: lead.company ?? "",
      primary_email: lead.primary_email ?? "",
      phone: lead.phone ?? "",
      title: lead.title ?? "",
      source: lead.source ?? "",
      status: lead.status ?? "new",
      notes: lead.notes ?? "",
      assigned_to: lead.assigned_to ?? null,
      assigned_to_name: lead.assigned_to_name ?? "",
    };
    const nextCustomFields = lead.custom_fields ?? {};
    setForm(nextForm);
    setCustomFieldValues(nextCustomFields);
    setInitialSnapshot(JSON.stringify([nextForm, nextCustomFields]));
  }, [mode, summaryQuery.data]);

  const currentSnapshot = useMemo(() => JSON.stringify([form, customFieldValues]), [form, customFieldValues]);
  const isDirty = currentSnapshot !== initialSnapshot;

  useEffect(() => {
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      if (!isDirty || submitting) return;
      event.preventDefault();
    }
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [isDirty, submitting]);

  function validate() {
    const email = form.primary_email.trim();
    if (!email) {
      setEmailError("Email is required.");
      document.getElementById("lead-primary-email")?.focus();
      return false;
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setEmailError("Enter a valid email address.");
      document.getElementById("lead-primary-email")?.focus();
      return false;
    }
    setEmailError(null);
    return true;
  }

  async function submit() {
    if (!validate()) return;
    try {
      setSubmitting(true);
      setSubmitError(null);
      const payload = pickEnabledModulePayload({
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
        custom_fields: customFieldValues,
      }, moduleFields, ["primary_email", "custom_fields"]);
      const endpoint = mode === "edit" ? `/sales/leads/${leadId}` : "/sales/leads";
      const res = await apiFetch(endpoint, {
        method: mode === "edit" ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null) as LeadResponse | { detail?: string } | null;
      if (!res.ok) throw new Error(body && "detail" in body ? body.detail : `Failed with ${res.status}`);
      const savedLeadId = mode === "edit" ? leadId : body && "lead_id" in body ? body.lead_id : null;
      await queryClient.invalidateQueries({ queryKey: ["sales-leads"] });
      if (savedLeadId) await queryClient.invalidateQueries({ queryKey: ["sales-lead-summary", String(savedLeadId)] });
      setInitialSnapshot(currentSnapshot);
      toast.success(mode === "edit" ? "Lead updated." : "Lead created.");
      router.push(savedLeadId ? `/dashboard/sales/leads/${savedLeadId}` : "/dashboard/sales/leads");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : `Failed to ${mode} lead`);
    } finally {
      setSubmitting(false);
    }
  }

  if (mode === "edit" && summaryQuery.isLoading) {
    return <Card className="p-6 text-sm text-copy-muted">Loading lead…</Card>;
  }

  if (mode === "edit" && summaryQuery.error) {
    return (
      <Card className="border-state-danger/40 p-6">
        <p className="text-sm text-state-danger">{summaryQuery.error instanceof Error ? summaryQuery.error.message : "Failed to load lead."}</p>
        <Button className="mt-4" variant="outline" onClick={() => void summaryQuery.refetch()}>Retry</Button>
      </Card>
    );
  }

  const title = mode === "edit" ? "Edit lead" : "Create lead";
  const cancelHref = mode === "edit" && leadId ? `/dashboard/sales/leads/${leadId}` : "/dashboard/sales/leads";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={title}
        description={mode === "edit" ? "Update lead details and qualification information." : "Capture a new prospect and prepare the first follow-up."}
        actions={(
          <Button asChild variant="ghost" size="sm">
            <Link href={cancelHref}><ArrowLeft />Back to {mode === "edit" ? "lead" : "leads"}</Link>
          </Button>
        )}
      />

      {submitError ? (
        <div role="alert" className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
          <div className="font-medium">We could not save this lead.</div>
          <div className="mt-1 text-copy-secondary">{submitError}</div>
        </div>
      ) : null}

      <RecordFormLayout
        sidebar={<LeadFormSidebarFields value={form} onChange={setForm} moduleFields={moduleFields} mode={mode} />}
        footer={(
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-copy-muted">{isDirty ? "You have unsaved changes." : mode === "edit" ? "No unsaved changes." : "Complete the required fields to create this lead."}</span>
            <div className="flex items-center gap-2">
              <Button asChild variant="outline"><Link href={cancelHref}>Cancel</Link></Button>
              <Button onClick={() => void submit()} disabled={submitting || (mode === "edit" && !isDirty)}>
                <Save />{submitting ? "Saving…" : mode === "edit" ? "Save changes" : "Create lead"}
              </Button>
            </div>
          </div>
        )}
      >
        <LeadFormMainFields
          value={form}
          onChange={setForm}
          customFields={customFieldsQuery.data ?? []}
          customFieldValues={customFieldValues}
          onCustomFieldChange={(fieldKey, value) => setCustomFieldValues((current) => ({ ...current, [fieldKey]: value }))}
          moduleFields={moduleFields}
          emailError={emailError}
        />
      </RecordFormLayout>
    </div>
  );
}
