"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import LinkedRecordPicker, { type LinkedRecordOption } from "@/components/crm/LinkedRecordPicker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBackdrop, DialogFooter, DialogHeader, DialogPanel, DialogTitle } from "@/components/ui/dialog";
import { DialogIconClose } from "@/components/ui/DialogIconClose";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api";
import { SUPPORT_CASES_QUERY_KEY, SUPPORT_CASES_SUMMARY_QUERY_KEY } from "@/hooks/support/useCases";

const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

const CATEGORIES = [
  { value: "general", label: "General" },
  { value: "billing", label: "Billing" },
  { value: "technical", label: "Technical" },
  { value: "order", label: "Order" },
  { value: "account", label: "Account" },
];

export default function CreateSupportCaseDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    subject: "",
    description: "",
    category: "general",
    priority: "medium",
    source: "",
    contact_id: null as number | null,
    organization_id: null as number | null,
    opportunity_id: null as number | null,
    quote_id: "",
    order_id: "",
    assigned_to_id: "",
    sla_due_at: "",
  });
  const [contactDisplay, setContactDisplay] = useState("");
  const [organizationDisplay, setOrganizationDisplay] = useState("");
  const [opportunityDisplay, setOpportunityDisplay] = useState("");
  const [quoteDisplay, setQuoteDisplay] = useState("");
  const [orderDisplay, setOrderDisplay] = useState("");
  const [assigneeDisplay, setAssigneeDisplay] = useState("");

  function reset() {
    setForm({ subject: "", description: "", category: "general", priority: "medium", source: "", contact_id: null, organization_id: null, opportunity_id: null, quote_id: "", order_id: "", assigned_to_id: "", sla_due_at: "" });
    setContactDisplay("");
    setOrganizationDisplay("");
    setOpportunityDisplay("");
    setQuoteDisplay("");
    setOrderDisplay("");
    setAssigneeDisplay("");
    setError(null);
  }

  function selectLinked(type: "contact" | "organization" | "opportunity", option: LinkedRecordOption) {
    if (type === "contact") {
      setForm((current) => ({ ...current, contact_id: option.contact_id ?? option.id, organization_id: current.organization_id ?? option.organization_id ?? null }));
      setContactDisplay(option.label);
      if (option.organization_id && !organizationDisplay) setOrganizationDisplay(option.organization_name ?? `Account #${option.organization_id}`);
    } else if (type === "organization") {
      setForm((current) => ({ ...current, organization_id: option.organization_id ?? option.id }));
      setOrganizationDisplay(option.label);
    } else {
      setForm((current) => ({ ...current, opportunity_id: option.id, contact_id: current.contact_id ?? option.contact_id ?? null, organization_id: current.organization_id ?? option.organization_id ?? null }));
      setOpportunityDisplay(option.label);
    }
  }

  async function handleSubmit() {
    if (!form.subject.trim() || saving) return;
    try {
      setSaving(true);
      setError(null);
      const payload = {
        subject: form.subject.trim(),
        description: form.description.trim() || null,
        category: form.category,
        priority: form.priority,
        source: form.source.trim() || null,
        contact_id: form.contact_id,
        organization_id: form.organization_id,
        opportunity_id: form.opportunity_id,
        quote_id: form.quote_id ? Number(form.quote_id) : null,
        order_id: form.order_id ? Number(form.order_id) : null,
        assigned_to_id: form.assigned_to_id ? Number(form.assigned_to_id) : null,
        sla_due_at: form.sla_due_at ? new Date(form.sla_due_at).toISOString() : null,
      };
      const res = await apiFetch("/support/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: SUPPORT_CASES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: SUPPORT_CASES_SUMMARY_QUERY_KEY }),
      ]);
      toast.success("Support case created.");
      setOpen(false);
      reset();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create support case");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" />New Case</Button>
      <Dialog open={open} onClose={() => { setOpen(false); reset(); }}>
        <DialogBackdrop />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel size="3xl">
            <DialogHeader><DialogTitle>Create Support Case</DialogTitle><DialogIconClose /></DialogHeader>
            <div className="mt-4 grid gap-5">
          {error ? <div className="rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-200">{error}</div> : null}
          <FieldGroup className="grid gap-4 md:grid-cols-2">
            <Field className="md:col-span-2">
              <FieldLabel>Subject <RequiredMark /></FieldLabel>
              <Input value={form.subject} onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))} placeholder="Customer cannot access latest order" />
            </Field>
            <Field>
              <FieldLabel>Priority</FieldLabel>
              <Select value={form.priority} onValueChange={(value) => setForm((current) => ({ ...current, priority: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORITIES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Category</FieldLabel>
              <Select value={form.category} onValueChange={(value) => setForm((current) => ({ ...current, category: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Source</FieldLabel>
              <Input value={form.source} onChange={(event) => setForm((current) => ({ ...current, source: event.target.value }))} placeholder="email, portal, phone" />
            </Field>
            <Field>
              <FieldLabel>Contact</FieldLabel>
              <LinkedRecordPicker recordType="contact" valueId={form.contact_id} displayValue={contactDisplay} onDisplayValueChange={(value) => { setContactDisplay(value); setForm((current) => ({ ...current, contact_id: null, opportunity_id: null, quote_id: "", order_id: "" })); setOpportunityDisplay(""); setQuoteDisplay(""); setOrderDisplay(""); }} onSelect={(option) => selectLinked("contact", option)} onClear={() => { setForm((current) => ({ ...current, contact_id: null, opportunity_id: null, quote_id: "", order_id: "" })); setContactDisplay(""); setOpportunityDisplay(""); setQuoteDisplay(""); setOrderDisplay(""); }} placeholder="Search contacts" queryKeyPrefix="support-case-contact" filters={{ organizationId: form.organization_id }} />
            </Field>
            <Field>
              <FieldLabel>Account</FieldLabel>
              <LinkedRecordPicker recordType="organization" valueId={form.organization_id} displayValue={organizationDisplay} onDisplayValueChange={(value) => { setOrganizationDisplay(value); setForm((current) => ({ ...current, organization_id: null, contact_id: null, opportunity_id: null, quote_id: "", order_id: "" })); setContactDisplay(""); setOpportunityDisplay(""); setQuoteDisplay(""); setOrderDisplay(""); }} onSelect={(option) => { setContactDisplay(""); setOpportunityDisplay(""); setQuoteDisplay(""); setOrderDisplay(""); setForm((current) => ({ ...current, contact_id: null, opportunity_id: null, quote_id: "", order_id: "" })); selectLinked("organization", option); }} onClear={() => { setForm((current) => ({ ...current, organization_id: null, contact_id: null, opportunity_id: null, quote_id: "", order_id: "" })); setOrganizationDisplay(""); setContactDisplay(""); setOpportunityDisplay(""); setQuoteDisplay(""); setOrderDisplay(""); }} placeholder="Search accounts" queryKeyPrefix="support-case-account" />
            </Field>
            <Field>
              <FieldLabel>Deal</FieldLabel>
              <LinkedRecordPicker recordType="opportunity" valueId={form.opportunity_id} displayValue={opportunityDisplay} onDisplayValueChange={(value) => { setOpportunityDisplay(value); setForm((current) => ({ ...current, opportunity_id: null, quote_id: "", order_id: "" })); setQuoteDisplay(""); setOrderDisplay(""); }} onSelect={(option) => selectLinked("opportunity", option)} onClear={() => { setForm((current) => ({ ...current, opportunity_id: null, quote_id: "", order_id: "" })); setOpportunityDisplay(""); setQuoteDisplay(""); setOrderDisplay(""); }} placeholder="Search deals" queryKeyPrefix="support-case-deal" filters={{ contactId: form.contact_id, organizationId: form.organization_id }} />
            </Field>
            <Field>
              <FieldLabel>SLA Due</FieldLabel>
              <Input type="datetime-local" value={form.sla_due_at} onChange={(event) => setForm((current) => ({ ...current, sla_due_at: event.target.value }))} />
            </Field>
            <Field>
              <FieldLabel>Quote</FieldLabel>
              <LinkedRecordPicker recordType="quote" valueId={form.quote_id ? Number(form.quote_id) : null} displayValue={quoteDisplay} onDisplayValueChange={(value) => { setQuoteDisplay(value); setForm((current) => ({ ...current, quote_id: "", order_id: "" })); setOrderDisplay(""); }} onSelect={(option) => { setQuoteDisplay(option.label); setForm((current) => ({ ...current, quote_id: String(option.id), order_id: "" })); setOrderDisplay(""); }} onClear={() => { setQuoteDisplay(""); setOrderDisplay(""); setForm((current) => ({ ...current, quote_id: "", order_id: "" })); }} placeholder="Search quotes" queryKeyPrefix="support-case-quote" filters={{ contactId: form.contact_id, organizationId: form.organization_id, opportunityId: form.opportunity_id }} />
            </Field>
            <Field>
              <FieldLabel>Order</FieldLabel>
              <LinkedRecordPicker recordType="order" valueId={form.order_id ? Number(form.order_id) : null} displayValue={orderDisplay} onDisplayValueChange={(value) => { setOrderDisplay(value); setForm((current) => ({ ...current, order_id: "" })); }} onSelect={(option) => { setOrderDisplay(option.label); setForm((current) => ({ ...current, order_id: String(option.id) })); }} onClear={() => { setOrderDisplay(""); setForm((current) => ({ ...current, order_id: "" })); }} placeholder="Search orders" queryKeyPrefix="support-case-order" filters={{ contactId: form.contact_id, organizationId: form.organization_id, opportunityId: form.opportunity_id, quoteId: form.quote_id ? Number(form.quote_id) : null }} />
            </Field>
            <Field>
              <FieldLabel>Assignee</FieldLabel>
              <LinkedRecordPicker recordType="user" valueId={form.assigned_to_id ? Number(form.assigned_to_id) : null} displayValue={assigneeDisplay} onDisplayValueChange={(value) => { setAssigneeDisplay(value); setForm((current) => ({ ...current, assigned_to_id: "" })); }} onSelect={(option) => { setAssigneeDisplay(option.label); setForm((current) => ({ ...current, assigned_to_id: String(option.id) })); }} onClear={() => { setAssigneeDisplay(""); setForm((current) => ({ ...current, assigned_to_id: "" })); }} placeholder="Search assignees" queryKeyPrefix="support-case-assignee" sourceModuleKey="support_cases" />
            </Field>
            <Field className="md:col-span-2">
              <FieldLabel>Description</FieldLabel>
              <Textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} rows={4} />
            </Field>
          </FieldGroup>
            </div>
            <DialogFooter className="mt-5">
              <Button variant="outline" onClick={() => { setOpen(false); reset(); }} disabled={saving}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={!form.subject.trim() || saving}>{saving ? "Creating..." : "Create Case"}</Button>
            </DialogFooter>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  );
}
