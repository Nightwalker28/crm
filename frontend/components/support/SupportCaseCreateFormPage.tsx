"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";

import LinkedRecordPicker, { type LinkedRecordOption } from "@/components/crm/LinkedRecordPicker";
import { RecordFormLayout } from "@/components/forms/RecordFormLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  SUPPORT_CASES_QUERY_KEY,
  SUPPORT_CASES_SUMMARY_QUERY_KEY,
  supportCaseQueryKey,
  type SupportCase,
} from "@/hooks/support/useCases";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { apiFetch } from "@/lib/api";

const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const CATEGORIES = ["general", "billing", "technical", "order", "account"] as const;

type FormState = {
  subject: string;
  description: string;
  category: string;
  priority: string;
  source: string;
  contact_id: number | null;
  organization_id: number | null;
  opportunity_id: number | null;
  quote_id: number | null;
  order_id: number | null;
  assigned_to_id: number | null;
};

const EMPTY_FORM: FormState = {
  subject: "",
  description: "",
  category: "general",
  priority: "medium",
  source: "",
  contact_id: null,
  organization_id: null,
  opportunity_id: null,
  quote_id: null,
  order_id: null,
  assigned_to_id: null,
};

export default function SupportCaseCreateFormPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [displays, setDisplays] = useState({
    contact: "",
    organization: "",
    opportunity: "",
    quote: "",
    order: "",
    assignee: "",
  });
  const [subjectError, setSubjectError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(EMPTY_FORM), [form]);

  useUnsavedChangesGuard(isDirty, submitting);

  function updateDisplay(key: keyof typeof displays, value: string) {
    setDisplays((current) => ({ ...current, [key]: value }));
  }

  function clearChildren(parent: "organization" | "contact" | "opportunity" | "quote") {
    if (parent === "organization") {
      setForm((current) => ({ ...current, contact_id: null, opportunity_id: null, quote_id: null, order_id: null }));
      setDisplays((current) => ({ ...current, contact: "", opportunity: "", quote: "", order: "" }));
    } else if (parent === "contact") {
      setForm((current) => ({ ...current, opportunity_id: null, quote_id: null, order_id: null }));
      setDisplays((current) => ({ ...current, opportunity: "", quote: "", order: "" }));
    } else if (parent === "opportunity") {
      setForm((current) => ({ ...current, quote_id: null, order_id: null }));
      setDisplays((current) => ({ ...current, quote: "", order: "" }));
    } else {
      setForm((current) => ({ ...current, order_id: null }));
      updateDisplay("order", "");
    }
  }

  function selectContact(option: LinkedRecordOption) {
    setForm((current) => ({
      ...current,
      contact_id: option.contact_id ?? option.id,
      organization_id: current.organization_id ?? option.organization_id ?? null,
    }));
    updateDisplay("contact", option.label);
    if (option.organization_id && !displays.organization) {
      updateDisplay("organization", option.organization_name ?? "Linked account");
    }
  }

  function selectOpportunity(option: LinkedRecordOption) {
    setForm((current) => ({
      ...current,
      opportunity_id: option.id,
      contact_id: current.contact_id ?? option.contact_id ?? null,
      organization_id: current.organization_id ?? option.organization_id ?? null,
    }));
    updateDisplay("opportunity", option.label);
  }

  async function submit() {
    if (!form.subject.trim()) {
      setSubjectError("Subject is required.");
      document.getElementById("support-case-subject")?.focus();
      return;
    }
    try {
      setSubmitting(true);
      setSubmitError(false);
      setSubjectError(null);
      const res = await apiFetch("/support/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          subject: form.subject.trim(),
          description: form.description.trim() || null,
          source: form.source.trim() || null,
        }),
      });
      const body = await res.json().catch(() => null) as SupportCase | null;
      if (!res.ok || !body?.id) throw new Error("Support case creation failed");
      queryClient.setQueryData(supportCaseQueryKey(body.id), body);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: SUPPORT_CASES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: SUPPORT_CASES_SUMMARY_QUERY_KEY }),
      ]);
      toast.success("Support case created.");
      router.push(`/dashboard/support/cases/${body.id}`);
    } catch {
      setSubmitError(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageShell
      title="Create support case"
      description="Capture the customer issue, ownership, and the records the support team needs to resolve it."
      actions={<Button asChild variant="ghost" size="sm"><Link href="/dashboard/support/cases"><ArrowLeft />Back to support</Link></Button>}
    >
      {submitError ? (
        <div role="alert" className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
          <div className="font-medium">We could not create this support case.</div>
          <div className="mt-1 text-copy-secondary">Check the entered information and try again.</div>
        </div>
      ) : null}

      <RecordFormLayout
        sidebar={
          <Card className="p-5">
            <h2 className="text-base font-semibold text-copy-primary">Ownership</h2>
            <FieldDescription className="mt-1">Set the queue context and responsible team member.</FieldDescription>
            <FieldGroup className="mt-5">
              <Field>
                <FieldLabel>Priority</FieldLabel>
                <Select value={form.priority} onValueChange={(priority) => setForm((current) => ({ ...current, priority }))}>
                  <SelectTrigger aria-label="Priority"><SelectValue /></SelectTrigger>
                  <SelectContent>{PRIORITIES.map((value) => <SelectItem key={value} value={value}>{titleCase(value)}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Category</FieldLabel>
                <Select value={form.category} onValueChange={(category) => setForm((current) => ({ ...current, category }))}>
                  <SelectTrigger aria-label="Category"><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map((value) => <SelectItem key={value} value={value}>{titleCase(value)}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="support-case-source">Source</FieldLabel>
                <Input id="support-case-source" value={form.source} onChange={(event) => setForm((current) => ({ ...current, source: event.target.value }))} placeholder="Email, portal, or phone" />
              </Field>
              <Field>
                <FieldLabel>Assignee</FieldLabel>
                <LinkedRecordPicker recordType="user" valueId={form.assigned_to_id} displayValue={displays.assignee} onDisplayValueChange={(value) => { updateDisplay("assignee", value); setForm((current) => ({ ...current, assigned_to_id: null })); }} onSelect={(option) => { updateDisplay("assignee", option.label); setForm((current) => ({ ...current, assigned_to_id: option.id })); }} onClear={() => { updateDisplay("assignee", ""); setForm((current) => ({ ...current, assigned_to_id: null })); }} placeholder="Search assignees" queryKeyPrefix="support-case-assignee" sourceModuleKey="support_cases" />
              </Field>
            </FieldGroup>
          </Card>
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-copy-muted">{isDirty ? "You have unsaved changes." : "Complete the required fields to create this case."}</span>
            <div className="flex items-center gap-2">
              <Button asChild variant="outline"><Link href="/dashboard/support/cases">Cancel</Link></Button>
              <Button onClick={() => void submit()} disabled={submitting}><Save />{submitting ? "Creating…" : "Create case"}</Button>
            </div>
          </div>
        }
      >
        <Card className="p-5">
          <h2 className="text-base font-semibold text-copy-primary">Customer issue</h2>
          <FieldDescription className="mt-1">Start with the information needed to understand and reproduce the issue.</FieldDescription>
          <FieldGroup className="mt-5">
            <Field>
              <FieldLabel htmlFor="support-case-subject">Subject <RequiredMark /></FieldLabel>
              <Input id="support-case-subject" value={form.subject} onChange={(event) => { setForm((current) => ({ ...current, subject: event.target.value })); if (subjectError) setSubjectError(null); }} aria-invalid={Boolean(subjectError)} aria-describedby={subjectError ? "support-case-subject-error" : undefined} placeholder="Customer cannot access latest order" />
              {subjectError ? <p id="support-case-subject-error" className="text-sm text-state-danger">{subjectError}</p> : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="support-case-description">Description</FieldLabel>
              <Textarea id="support-case-description" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} rows={7} placeholder="Describe the issue, impact, and any troubleshooting already completed." />
            </Field>
          </FieldGroup>
        </Card>

        <Card className="p-5">
          <h2 className="text-base font-semibold text-copy-primary">Requester and related records</h2>
          <FieldDescription className="mt-1">Search by name or record number. Changing a parent record clears incompatible child links.</FieldDescription>
          <FieldGroup className="mt-5 grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>Account</FieldLabel>
              <LinkedRecordPicker recordType="organization" valueId={form.organization_id} displayValue={displays.organization} onDisplayValueChange={(value) => { updateDisplay("organization", value); setForm((current) => ({ ...current, organization_id: null })); clearChildren("organization"); }} onSelect={(option) => { clearChildren("organization"); setForm((current) => ({ ...current, organization_id: option.organization_id ?? option.id })); updateDisplay("organization", option.label); }} onClear={() => { setForm((current) => ({ ...current, organization_id: null })); updateDisplay("organization", ""); clearChildren("organization"); }} placeholder="Search accounts" queryKeyPrefix="support-case-account" />
            </Field>
            <Field>
              <FieldLabel>Contact</FieldLabel>
              <LinkedRecordPicker recordType="contact" valueId={form.contact_id} displayValue={displays.contact} onDisplayValueChange={(value) => { updateDisplay("contact", value); setForm((current) => ({ ...current, contact_id: null })); clearChildren("contact"); }} onSelect={selectContact} onClear={() => { setForm((current) => ({ ...current, contact_id: null })); updateDisplay("contact", ""); clearChildren("contact"); }} placeholder="Search contacts" queryKeyPrefix="support-case-contact" filters={{ organizationId: form.organization_id }} />
            </Field>
            <Field>
              <FieldLabel>Deal</FieldLabel>
              <LinkedRecordPicker recordType="opportunity" valueId={form.opportunity_id} displayValue={displays.opportunity} onDisplayValueChange={(value) => { updateDisplay("opportunity", value); setForm((current) => ({ ...current, opportunity_id: null })); clearChildren("opportunity"); }} onSelect={selectOpportunity} onClear={() => { setForm((current) => ({ ...current, opportunity_id: null })); updateDisplay("opportunity", ""); clearChildren("opportunity"); }} placeholder="Search deals" queryKeyPrefix="support-case-deal" filters={{ contactId: form.contact_id, organizationId: form.organization_id }} />
            </Field>
            <Field>
              <FieldLabel>Quote</FieldLabel>
              <LinkedRecordPicker recordType="quote" valueId={form.quote_id} displayValue={displays.quote} onDisplayValueChange={(value) => { updateDisplay("quote", value); setForm((current) => ({ ...current, quote_id: null })); clearChildren("quote"); }} onSelect={(option) => { updateDisplay("quote", option.label); setForm((current) => ({ ...current, quote_id: option.id, order_id: null })); clearChildren("quote"); }} onClear={() => { updateDisplay("quote", ""); setForm((current) => ({ ...current, quote_id: null })); clearChildren("quote"); }} placeholder="Search quotes" queryKeyPrefix="support-case-quote" filters={{ contactId: form.contact_id, organizationId: form.organization_id, opportunityId: form.opportunity_id }} />
            </Field>
            <Field className="md:col-span-2">
              <FieldLabel>Order</FieldLabel>
              <LinkedRecordPicker recordType="order" valueId={form.order_id} displayValue={displays.order} onDisplayValueChange={(value) => { updateDisplay("order", value); setForm((current) => ({ ...current, order_id: null })); }} onSelect={(option) => { updateDisplay("order", option.label); setForm((current) => ({ ...current, order_id: option.id })); }} onClear={() => { updateDisplay("order", ""); setForm((current) => ({ ...current, order_id: null })); }} placeholder="Search orders" queryKeyPrefix="support-case-order" filters={{ contactId: form.contact_id, organizationId: form.organization_id, opportunityId: form.opportunity_id, quoteId: form.quote_id }} />
            </Field>
          </FieldGroup>
        </Card>
      </RecordFormLayout>
    </PageShell>
  );
}

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
