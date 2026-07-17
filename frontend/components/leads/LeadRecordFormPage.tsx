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
import { PageHeader } from "@/components/ui/PageHeader";
import { RouteErrorState, RouteLoadingState } from "@/components/ui/RouteStates";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { pickEnabledModulePayload, useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";

type LeadSummary = {
  lead: LeadFormValue & {
    lead_id: number;
    custom_fields?: Record<string, unknown> | null;
    updated_at?: string | null;
  };
};

type LeadResponse = { lead_id: number };

async function fetchLeadSummary(leadId: string) {
  const res = await apiFetch(`/sales/leads/${leadId}/summary`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
  return body as LeadSummary;
}

function toDatetimeLocalValue(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function toIsoOrNull(value: string) {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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
      next_follow_up_at: toDatetimeLocalValue(lead.next_follow_up_at),
      team_id: lead.team_id ?? null,
      team_name: lead.team_name ?? "",
      tags: Array.isArray(lead.tags) ? lead.tags : [],
    };
    const nextCustomFields = lead.custom_fields ?? {};
    setForm(nextForm);
    setCustomFieldValues(nextCustomFields);
    setInitialSnapshot(JSON.stringify([nextForm, nextCustomFields]));
  }, [mode, summaryQuery.data]);

  const currentSnapshot = useMemo(() => JSON.stringify([form, customFieldValues]), [form, customFieldValues]);
  const isDirty = currentSnapshot !== initialSnapshot;

  useUnsavedChangesGuard(isDirty, submitting);

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
        next_follow_up_at: toIsoOrNull(form.next_follow_up_at),
        team_id: form.team_id,
        tags: form.tags,
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
    } catch {
      setSubmitError(mode === "edit" ? "The lead could not be updated. Check the fields and try again." : "The lead could not be created. Check the fields and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (mode === "edit" && summaryQuery.isLoading) {
    return <RouteLoadingState label="lead" />;
  }

  if (mode === "edit" && summaryQuery.error) {
    return <RouteErrorState title="Unable to load this lead" reset={() => void summaryQuery.refetch()} backHref="/dashboard/sales/leads" backLabel="Back to leads" />;
  }

  const title = mode === "edit" ? "Edit lead" : "Create lead";
  const cancelHref = mode === "edit" && leadId ? `/dashboard/sales/leads/${leadId}` : "/dashboard/sales/leads";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={title}
        eyebrow={mode === "edit" && summaryQuery.data?.lead.updated_at ? `Last modified ${formatDateTime(summaryQuery.data.lead.updated_at)}` : undefined}
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
