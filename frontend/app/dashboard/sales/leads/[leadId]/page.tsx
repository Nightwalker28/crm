"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { CheckSquare, Mail, Phone, StickyNote } from "lucide-react";
import { toast } from "sonner";

import CustomFieldInputs from "@/components/customFields/CustomFieldInputs";
import RecordActivityTimeline from "@/components/recordActivity/RecordActivityTimeline";
import RecordCommentsPanel from "@/components/recordActivity/RecordCommentsPanel";
import RecordDocumentsPanel from "@/components/documents/RecordDocumentsPanel";
import FollowUpPanel from "@/components/recordActivity/FollowUpPanel";
import RecordPageHeader from "@/components/recordActivity/RecordPageHeader";
import RecordTasksPanel from "@/components/recordActivity/RecordTasksPanel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RecordTabs } from "@/components/ui/RecordTabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { isModuleFieldEnabled, pickEnabledModulePayload, useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";

type LeadSummary = {
  lead: {
    lead_id: number;
    first_name?: string | null;
    last_name?: string | null;
    company?: string | null;
    primary_email: string;
    phone?: string | null;
    title?: string | null;
    source?: string | null;
    status?: string | null;
    notes?: string | null;
    last_contacted_at?: string | null;
    last_contacted_channel?: string | null;
    custom_fields?: Record<string, unknown> | null;
  };
};

type LeadForm = {
  first_name: string;
  last_name: string;
  company: string;
  primary_email: string;
  phone: string;
  title: string;
  source: string;
  status: string;
  notes: string;
};

const emptyForm: LeadForm = {
  first_name: "",
  last_name: "",
  company: "",
  primary_email: "",
  phone: "",
  title: "",
  source: "",
  status: "new",
  notes: "",
};

const STATUSES = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "unqualified", label: "Unqualified" },
  { value: "converted", label: "Converted" },
];

export default function LeadDetailPage() {
  const params = useParams<{ leadId: string }>();
  const queryClient = useQueryClient();
  const [summary, setSummary] = useState<LeadSummary | null>(null);
  const [form, setForm] = useState<LeadForm>(emptyForm);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const customFieldsQuery = useModuleCustomFields("sales_leads", true);
  const { fields: moduleFields } = useModuleFieldConfigs("sales_leads");
  const fieldEnabled = (fieldKey: string) => isModuleFieldEnabled(moduleFields, fieldKey);

  async function loadSummary(signal?: { cancelled: boolean }) {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch(`/sales/leads/${params.leadId}/summary`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      if (signal?.cancelled) return;
      const data = body as LeadSummary;
      setSummary(data);
      setForm({
        first_name: data.lead.first_name ?? "",
        last_name: data.lead.last_name ?? "",
        company: data.lead.company ?? "",
        primary_email: data.lead.primary_email ?? "",
        phone: data.lead.phone ?? "",
        title: data.lead.title ?? "",
        source: data.lead.source ?? "",
        status: data.lead.status ?? "new",
        notes: data.lead.notes ?? "",
      });
      setCustomFieldValues(data.lead.custom_fields ?? {});
    } catch (loadError) {
      if (!signal?.cancelled) setError(loadError instanceof Error ? loadError.message : "Failed to load lead");
    } finally {
      if (!signal?.cancelled) setLoading(false);
    }
  }

  useEffect(() => {
    const signal = { cancelled: false };
    void loadSummary(signal);
    return () => {
      signal.cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.leadId]);

  async function handleSave() {
    try {
      setSaving(true);
      setError(null);
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
        custom_fields: customFieldValues,
      }, moduleFields, ["primary_email", "custom_fields"]);
      const res = await apiFetch(`/sales/leads/${params.leadId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-leads"] }),
        queryClient.refetchQueries({ queryKey: ["sales-leads"], type: "all" }),
      ]);
      await loadSummary();
      toast.success("Lead updated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save lead");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <RecordPageHeader
        backHref="/dashboard/sales/leads"
        backLabel="Back to Leads"
        title={summary ? `${summary.lead.first_name || ""} ${summary.lead.last_name || ""}`.trim() || summary.lead.primary_email || "Lead" : "Lead"}
        description="Review the lead record, qualification status, and follow-up history."
        primaryAction={<Button onClick={handleSave} disabled={saving || !form.primary_email.trim()}>{saving ? "Saving..." : "Save Lead"}</Button>}
      />

      {error ? <div className="rounded-md border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div> : null}

      {loading || !summary ? (
        <Card className="px-5 py-5 text-sm text-neutral-500">Loading lead...</Card>
      ) : (
        <>
          <Card className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              {summary.lead.primary_email ? (
                <Button asChild size="sm" variant="outline">
                  <a href={`mailto:${summary.lead.primary_email}`}><Mail />Email</a>
                </Button>
              ) : null}
              {fieldEnabled("phone") && summary.lead.phone ? (
                <Button asChild size="sm" variant="outline">
                  <a href={`tel:${summary.lead.phone}`}><Phone />Call</a>
                </Button>
              ) : null}
              <Button type="button" size="sm" variant="ghost" onClick={() => document.getElementById("lead-record-tools")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                <StickyNote />Note
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => document.getElementById("lead-record-tools")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                <CheckSquare />Task
              </Button>
              <div className="ml-auto text-xs text-neutral-500">
                Last contacted: {summary.lead.last_contacted_at ? formatDateTime(summary.lead.last_contacted_at) : "Not logged"}
              </div>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <Card className="px-5 py-5">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-neutral-100">Lead Details</h2>
                <FieldDescription className="mt-1">Edit the record directly on the page.</FieldDescription>
              </div>
              <FieldGroup className="grid gap-4 md:grid-cols-2">
                {fieldEnabled("first_name") ? <Field><FieldLabel>First Name</FieldLabel><Input value={form.first_name} onChange={(event) => setForm((current) => ({ ...current, first_name: event.target.value }))} /></Field> : null}
                {fieldEnabled("last_name") ? <Field><FieldLabel>Last Name</FieldLabel><Input value={form.last_name} onChange={(event) => setForm((current) => ({ ...current, last_name: event.target.value }))} /></Field> : null}
                {fieldEnabled("primary_email") ? <Field><FieldLabel>Email</FieldLabel><Input type="email" value={form.primary_email} onChange={(event) => setForm((current) => ({ ...current, primary_email: event.target.value }))} /></Field> : null}
                {fieldEnabled("phone") ? <Field><FieldLabel>Phone</FieldLabel><Input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} /></Field> : null}
                {fieldEnabled("company") ? <Field><FieldLabel>Company</FieldLabel><Input value={form.company} onChange={(event) => setForm((current) => ({ ...current, company: event.target.value }))} /></Field> : null}
                {fieldEnabled("title") ? <Field><FieldLabel>Job Title</FieldLabel><Input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} /></Field> : null}
                {fieldEnabled("source") ? <Field><FieldLabel>Source</FieldLabel><Input value={form.source} onChange={(event) => setForm((current) => ({ ...current, source: event.target.value }))} /></Field> : null}
                {fieldEnabled("status") ? (
                  <Field>
                    <FieldLabel>Status</FieldLabel>
                    <Select value={form.status} onValueChange={(value) => setForm((current) => ({ ...current, status: value }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((status) => <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                ) : null}
              </FieldGroup>
              {fieldEnabled("notes") ? (
                <div className="mt-4">
                  <Field><FieldLabel>Notes</FieldLabel><Input value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></Field>
                </div>
              ) : null}
              <div className="mt-4">
                <CustomFieldInputs
                  definitions={customFieldsQuery.data ?? []}
                  values={customFieldValues}
                  onChange={(fieldKey, value) => setCustomFieldValues((current) => ({ ...current, [fieldKey]: value }))}
                />
              </div>
            </Card>

            <Card className="px-5 py-5">
              <h2 className="text-lg font-semibold text-neutral-100">Summary</h2>
              <div className="mt-4 grid gap-3">
                <SummaryTile label="Company" value={summary.lead.company || "No company recorded"} />
                <SummaryTile label="Source" value={summary.lead.source || "No source recorded"} />
                <SummaryTile label="Status" value={(summary.lead.status || "new").replace(/_/g, " ")} />
              </div>
            </Card>
          </div>

          <div id="lead-record-tools" className="scroll-mt-6">
            <RecordTabs
              tabs={[
                { id: "activity", label: "Activity", content: <RecordActivityTimeline moduleKey="sales_leads" entityId={summary.lead.lead_id} description="Lead-level create, update, delete, restore, and note history." /> },
                { id: "notes", label: "Notes", content: <RecordCommentsPanel moduleKey="sales_leads" entityId={summary.lead.lead_id} /> },
                { id: "documents", label: "Documents", content: <RecordDocumentsPanel moduleKey="sales_leads" entityId={summary.lead.lead_id} /> },
                { id: "tasks", label: "Tasks", content: <RecordTasksPanel moduleKey="sales_leads" entityId={summary.lead.lead_id} /> },
                { id: "follow-up", label: "Follow-up", content: <FollowUpPanel endpoint={`/sales/leads/${summary.lead.lead_id}/follow-up`} lastContactedAt={summary.lead.last_contacted_at} lastContactedChannel={summary.lead.last_contacted_channel} email={summary.lead.primary_email} phone={summary.lead.phone} onLogged={() => loadSummary()} /> },
              ]}
            />
          </div>
        </>
      )}
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-2 text-sm capitalize text-neutral-100">{value}</div>
    </div>
  );
}
