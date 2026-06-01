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
import { apiFetch } from "@/lib/api";

const STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "review", label: "Review" },
  { value: "sent", label: "Sent" },
  { value: "partially_signed", label: "Partially Signed" },
  { value: "signed", label: "Signed" },
  { value: "active", label: "Active" },
  { value: "expired", label: "Expired" },
  { value: "cancelled", label: "Cancelled" },
];

type ContractForm = {
  title: string;
  status: string;
  value_amount: string;
  currency: string;
  effective_date: string;
  expiration_date: string;
  renewal_date: string;
  contact_id: number | null;
  organization_id: number | null;
  opportunity_id: number | null;
  quote_id: string;
  order_id: string;
  document_id: string;
  owner_id: string;
};

const INITIAL_FORM: ContractForm = {
  title: "",
  status: "draft",
  value_amount: "",
  currency: "USD",
  effective_date: "",
  expiration_date: "",
  renewal_date: "",
  contact_id: null as number | null,
  organization_id: null as number | null,
  opportunity_id: null as number | null,
  quote_id: "",
  order_id: "",
  document_id: "",
  owner_id: "",
};

export default function CreateContractDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(INITIAL_FORM);
  const [contactDisplay, setContactDisplay] = useState("");
  const [organizationDisplay, setOrganizationDisplay] = useState("");
  const [opportunityDisplay, setOpportunityDisplay] = useState("");
  const [quoteDisplay, setQuoteDisplay] = useState("");
  const [orderDisplay, setOrderDisplay] = useState("");
  const [documentDisplay, setDocumentDisplay] = useState("");
  const [ownerDisplay, setOwnerDisplay] = useState("");

  function reset() {
    setForm(INITIAL_FORM);
    setContactDisplay("");
    setOrganizationDisplay("");
    setOpportunityDisplay("");
    setQuoteDisplay("");
    setOrderDisplay("");
    setDocumentDisplay("");
    setOwnerDisplay("");
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
    if (!form.title.trim() || saving) return;
    try {
      setSaving(true);
      setError(null);
      const payload = {
        title: form.title.trim(),
        status: form.status,
        value_amount: form.value_amount ? Number(form.value_amount) : null,
        currency: form.currency.trim() || null,
        effective_date: form.effective_date || null,
        expiration_date: form.expiration_date || null,
        renewal_date: form.renewal_date || null,
        contact_id: form.contact_id,
        organization_id: form.organization_id,
        opportunity_id: form.opportunity_id,
        quote_id: form.quote_id ? Number(form.quote_id) : null,
        order_id: form.order_id ? Number(form.order_id) : null,
        document_id: form.document_id ? Number(form.document_id) : null,
        owner_id: form.owner_id ? Number(form.owner_id) : null,
      };
      const res = await apiFetch("/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      await queryClient.invalidateQueries({ queryKey: ["contracts"] });
      toast.success("Contract created.");
      setOpen(false);
      reset();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create contract");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" />New Contract</Button>
      <Dialog open={open} onClose={() => { setOpen(false); reset(); }}>
        <DialogBackdrop />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel size="3xl">
            <DialogHeader><DialogTitle>Create Contract</DialogTitle><DialogIconClose /></DialogHeader>
            <div className="mt-4 grid gap-5">
              {error ? <div className="rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-200">{error}</div> : null}
              <FieldGroup className="grid gap-4 md:grid-cols-2">
                <Field className="md:col-span-2">
                  <FieldLabel>Title <RequiredMark /></FieldLabel>
                  <Input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="Annual services agreement" />
                </Field>
                <Field>
                  <FieldLabel>Status</FieldLabel>
                  <Select value={form.status} onValueChange={(value) => setForm((current) => ({ ...current, status: value }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{STATUSES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel>Currency</FieldLabel>
                  <Input value={form.currency} onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))} maxLength={10} />
                </Field>
                <Field>
                  <FieldLabel>Value</FieldLabel>
                  <Input type="number" min="0" step="0.01" value={form.value_amount} onChange={(event) => setForm((current) => ({ ...current, value_amount: event.target.value }))} />
                </Field>
                <Field>
                  <FieldLabel>Owner</FieldLabel>
                  <LinkedRecordPicker recordType="user" valueId={form.owner_id ? Number(form.owner_id) : null} displayValue={ownerDisplay} onDisplayValueChange={(value) => { setOwnerDisplay(value); setForm((current) => ({ ...current, owner_id: "" })); }} onSelect={(option) => { setOwnerDisplay(option.label); setForm((current) => ({ ...current, owner_id: String(option.id) })); }} onClear={() => { setOwnerDisplay(""); setForm((current) => ({ ...current, owner_id: "" })); }} placeholder="Search owners" queryKeyPrefix="contract-owner" sourceModuleKey="contracts" />
                </Field>
                <Field>
                  <FieldLabel>Effective Date</FieldLabel>
                  <Input type="date" value={form.effective_date} onChange={(event) => setForm((current) => ({ ...current, effective_date: event.target.value }))} />
                </Field>
                <Field>
                  <FieldLabel>Expiration Date</FieldLabel>
                  <Input type="date" value={form.expiration_date} onChange={(event) => setForm((current) => ({ ...current, expiration_date: event.target.value }))} />
                </Field>
                <Field>
                  <FieldLabel>Renewal Date</FieldLabel>
                  <Input type="date" value={form.renewal_date} onChange={(event) => setForm((current) => ({ ...current, renewal_date: event.target.value }))} />
                </Field>
                <Field>
                  <FieldLabel>Contact</FieldLabel>
                  <LinkedRecordPicker recordType="contact" valueId={form.contact_id} displayValue={contactDisplay} onDisplayValueChange={(value) => { setContactDisplay(value); setForm((current) => ({ ...current, contact_id: null, opportunity_id: null, quote_id: "", order_id: "", document_id: "" })); setOpportunityDisplay(""); setQuoteDisplay(""); setOrderDisplay(""); setDocumentDisplay(""); }} onSelect={(option) => selectLinked("contact", option)} onClear={() => { setForm((current) => ({ ...current, contact_id: null, opportunity_id: null, quote_id: "", order_id: "", document_id: "" })); setContactDisplay(""); setOpportunityDisplay(""); setQuoteDisplay(""); setOrderDisplay(""); setDocumentDisplay(""); }} placeholder="Search contacts" queryKeyPrefix="contract-contact" filters={{ organizationId: form.organization_id }} />
                </Field>
                <Field>
                  <FieldLabel>Account</FieldLabel>
                  <LinkedRecordPicker recordType="organization" valueId={form.organization_id} displayValue={organizationDisplay} onDisplayValueChange={(value) => { setOrganizationDisplay(value); setForm((current) => ({ ...current, organization_id: null, contact_id: null, opportunity_id: null, quote_id: "", order_id: "", document_id: "" })); setContactDisplay(""); setOpportunityDisplay(""); setQuoteDisplay(""); setOrderDisplay(""); setDocumentDisplay(""); }} onSelect={(option) => { setContactDisplay(""); setOpportunityDisplay(""); setQuoteDisplay(""); setOrderDisplay(""); setDocumentDisplay(""); setForm((current) => ({ ...current, contact_id: null, opportunity_id: null, quote_id: "", order_id: "", document_id: "" })); selectLinked("organization", option); }} onClear={() => { setForm((current) => ({ ...current, organization_id: null, contact_id: null, opportunity_id: null, quote_id: "", order_id: "", document_id: "" })); setOrganizationDisplay(""); setContactDisplay(""); setOpportunityDisplay(""); setQuoteDisplay(""); setOrderDisplay(""); setDocumentDisplay(""); }} placeholder="Search accounts" queryKeyPrefix="contract-account" />
                </Field>
                <Field>
                  <FieldLabel>Deal</FieldLabel>
                  <LinkedRecordPicker recordType="opportunity" valueId={form.opportunity_id} displayValue={opportunityDisplay} onDisplayValueChange={(value) => { setOpportunityDisplay(value); setForm((current) => ({ ...current, opportunity_id: null, quote_id: "", order_id: "" })); setQuoteDisplay(""); setOrderDisplay(""); }} onSelect={(option) => selectLinked("opportunity", option)} onClear={() => { setForm((current) => ({ ...current, opportunity_id: null, quote_id: "", order_id: "" })); setOpportunityDisplay(""); setQuoteDisplay(""); setOrderDisplay(""); }} placeholder="Search deals" queryKeyPrefix="contract-deal" filters={{ contactId: form.contact_id, organizationId: form.organization_id }} />
                </Field>
                <Field>
                  <FieldLabel>Quote</FieldLabel>
                  <LinkedRecordPicker recordType="quote" valueId={form.quote_id ? Number(form.quote_id) : null} displayValue={quoteDisplay} onDisplayValueChange={(value) => { setQuoteDisplay(value); setForm((current) => ({ ...current, quote_id: "", order_id: "" })); setOrderDisplay(""); }} onSelect={(option) => { setQuoteDisplay(option.label); setForm((current) => ({ ...current, quote_id: String(option.id), order_id: "" })); setOrderDisplay(""); }} onClear={() => { setQuoteDisplay(""); setOrderDisplay(""); setForm((current) => ({ ...current, quote_id: "", order_id: "" })); }} placeholder="Search quotes" queryKeyPrefix="contract-quote" filters={{ contactId: form.contact_id, organizationId: form.organization_id, opportunityId: form.opportunity_id }} />
                </Field>
                <Field>
                  <FieldLabel>Order</FieldLabel>
                  <LinkedRecordPicker recordType="order" valueId={form.order_id ? Number(form.order_id) : null} displayValue={orderDisplay} onDisplayValueChange={(value) => { setOrderDisplay(value); setForm((current) => ({ ...current, order_id: "" })); }} onSelect={(option) => { setOrderDisplay(option.label); setForm((current) => ({ ...current, order_id: String(option.id) })); }} onClear={() => { setOrderDisplay(""); setForm((current) => ({ ...current, order_id: "" })); }} placeholder="Search orders" queryKeyPrefix="contract-order" filters={{ contactId: form.contact_id, organizationId: form.organization_id, opportunityId: form.opportunity_id, quoteId: form.quote_id ? Number(form.quote_id) : null }} />
                </Field>
                <Field>
                  <FieldLabel>Document</FieldLabel>
                  <LinkedRecordPicker recordType="document" valueId={form.document_id ? Number(form.document_id) : null} displayValue={documentDisplay} onDisplayValueChange={(value) => { setDocumentDisplay(value); setForm((current) => ({ ...current, document_id: "" })); }} onSelect={(option) => { setDocumentDisplay(option.label); setForm((current) => ({ ...current, document_id: String(option.id) })); }} onClear={() => { setDocumentDisplay(""); setForm((current) => ({ ...current, document_id: "" })); }} placeholder="Search documents" queryKeyPrefix="contract-document" linkedModuleKey={form.contact_id ? "sales_contacts" : form.organization_id ? "sales_organizations" : undefined} linkedEntityId={form.contact_id ?? form.organization_id} />
                </Field>
              </FieldGroup>
            </div>
            <DialogFooter className="mt-5">
              <Button variant="outline" onClick={() => { setOpen(false); reset(); }} disabled={saving}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={!form.title.trim() || saving}>{saving ? "Creating..." : "Create Contract"}</Button>
            </DialogFooter>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  );
}
