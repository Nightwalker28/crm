"use client";

import { useEffect, useMemo, useState } from "react";

import CustomFieldInputs from "@/components/customFields/CustomFieldInputs";
import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBackdrop, DialogFooter, DialogHeader, DialogPanel, DialogTitle } from "@/components/ui/dialog";
import { DialogIconClose } from "@/components/ui/DialogIconClose";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isModuleFieldEnabled, pickEnabledModulePayload, useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { apiFetch } from "@/lib/api";

type QuoteForm = {
  quote_number: string;
  title: string;
  customer_name: string;
  contact_id: number | null;
  organization_id: number | null;
  opportunity_id: string;
  status: string;
  issue_date: string;
  expiry_date: string;
  currency: string;
  subtotal_amount: string;
  discount_amount: string;
  tax_amount: string;
  total_amount: string;
  notes: string;
};

const emptyForm: QuoteForm = {
  quote_number: "",
  title: "",
  customer_name: "",
  contact_id: null,
  organization_id: null,
  opportunity_id: "",
  status: "draft",
  issue_date: "",
  expiry_date: "",
  currency: "USD",
  subtotal_amount: "0",
  discount_amount: "0",
  tax_amount: "0",
  total_amount: "0",
  notes: "",
};

const STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "accepted", label: "Accepted" },
  { value: "declined", label: "Declined" },
  { value: "expired", label: "Expired" },
];

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

export default function CreateQuoteModal({ isOpen, onClose, onSuccess }: Props) {
  const [form, setForm] = useState<QuoteForm>(emptyForm);
  const [contactSearch, setContactSearch] = useState("");
  const [accountSearch, setAccountSearch] = useState("");
  const [dealSearch, setDealSearch] = useState("");
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const customFieldsQuery = useModuleCustomFields("sales_quotes", isOpen);
  const { fields: moduleFields } = useModuleFieldConfigs("sales_quotes", false, isOpen);
  const fieldEnabled = (fieldKey: string) => isModuleFieldEnabled(moduleFields, fieldKey);
  const canSubmit = useMemo(() => Boolean(form.customer_name.trim()), [form.customer_name]);

  useEffect(() => {
    if (!isOpen) return;
    setForm(emptyForm);
    setContactSearch("");
    setAccountSearch("");
    setDealSearch("");
    setCustomFieldValues({});
    setError(null);
  }, [isOpen]);

  function closeModal() {
    setForm(emptyForm);
    setContactSearch("");
    setAccountSearch("");
    setDealSearch("");
    setCustomFieldValues({});
    setError(null);
    onClose();
  }

  async function submit() {
    try {
      setIsSubmitting(true);
      setError(null);
      const payload = pickEnabledModulePayload({
        quote_number: form.quote_number.trim() || null,
        title: form.title.trim() || null,
        customer_name: form.customer_name.trim(),
        contact_id: form.contact_id,
        organization_id: form.organization_id,
        opportunity_id: form.opportunity_id.trim() ? Number(form.opportunity_id) : null,
        status: form.status,
        issue_date: form.issue_date || null,
        expiry_date: form.expiry_date || null,
        currency: form.currency.trim().toUpperCase() || "USD",
        subtotal_amount: form.subtotal_amount || "0",
        discount_amount: form.discount_amount || "0",
        tax_amount: form.tax_amount || "0",
        total_amount: form.total_amount || "0",
        notes: form.notes.trim() || null,
        custom_fields: customFieldValues,
      }, moduleFields, ["customer_name", "contact_id", "organization_id", "opportunity_id", "custom_fields"]);
      const res = await apiFetch("/sales/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      onSuccess();
      closeModal();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create quote");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={isOpen} onClose={closeModal}>
      <DialogBackdrop />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel size="2xl">
          <DialogHeader>
            <DialogTitle>Create Quote</DialogTitle>
            <DialogIconClose />
          </DialogHeader>
          <div className="mt-4 space-y-4">
            {error ? <p className="text-sm text-red-400">{error}</p> : null}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {fieldEnabled("quote_number") ? <Field label="Quote number"><Input value={form.quote_number} onChange={(event) => setForm({ ...form, quote_number: event.target.value })} placeholder="Auto-generated if blank" /></Field> : null}
              {fieldEnabled("customer_name") ? <Field label="Customer" required><Input value={form.customer_name} onChange={(event) => setForm({ ...form, customer_name: event.target.value })} /></Field> : null}
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {fieldEnabled("contact_id") ? (
                <Field label="Contact">
                  <LinkedRecordPicker
                    recordType="contact"
                    valueId={form.contact_id}
                    displayValue={contactSearch}
                    onDisplayValueChange={(value) => {
                      setContactSearch(value);
                      setDealSearch("");
                      setForm((current) => ({ ...current, contact_id: null, opportunity_id: "" }));
                    }}
                    onSelect={(option) => {
                      setContactSearch(option.label);
                      setForm((current) => ({
                        ...current,
                        contact_id: option.id,
                        organization_id: option.organization_id ?? current.organization_id,
                        customer_name: current.customer_name.trim() ? current.customer_name : option.label,
                      }));
                      if (option.organization_id) {
                        setAccountSearch(option.organization_name || `Account #${option.organization_id}`);
                      }
                    }}
                    onClear={() => {
                      setContactSearch("");
                      setForm((current) => ({ ...current, contact_id: null }));
                    }}
                    placeholder="Search contacts"
                    queryKeyPrefix="quote-create-contact"
                    filters={{ organizationId: form.organization_id }}
                  />
                </Field>
              ) : null}
              {fieldEnabled("organization_id") ? (
                <Field label="Account">
                  <LinkedRecordPicker
                    recordType="organization"
                    valueId={form.organization_id}
                    displayValue={accountSearch}
                    onDisplayValueChange={(value) => {
                      setAccountSearch(value);
                      setContactSearch("");
                      setDealSearch("");
                      setForm((current) => ({ ...current, organization_id: null, contact_id: null, opportunity_id: "" }));
                    }}
                    onSelect={(option) => {
                      setAccountSearch(option.label);
                      setForm((current) => ({
                        ...current,
                        organization_id: option.id,
                        contact_id: null,
                        opportunity_id: "",
                        customer_name: current.customer_name.trim() ? current.customer_name : option.label,
                      }));
                      setContactSearch("");
                      setDealSearch("");
                    }}
                    onClear={() => {
                      setAccountSearch("");
                      setContactSearch("");
                      setDealSearch("");
                      setForm((current) => ({ ...current, organization_id: null, contact_id: null, opportunity_id: "" }));
                    }}
                    placeholder="Search accounts"
                    queryKeyPrefix="quote-create-account"
                  />
                </Field>
              ) : null}
              {fieldEnabled("opportunity_id") ? (
                <Field label="Deal">
                  <LinkedRecordPicker
                    recordType="opportunity"
                    valueId={form.opportunity_id ? Number(form.opportunity_id) : null}
                    displayValue={dealSearch}
                    onDisplayValueChange={(value) => {
                      setDealSearch(value);
                      setForm((current) => ({ ...current, opportunity_id: "" }));
                    }}
                    onSelect={(option) => {
                      setDealSearch(option.label);
                      if (option.contact_id) {
                        setContactSearch(`Contact #${option.contact_id}`);
                      }
                      if (option.organization_id) {
                        setAccountSearch(`Account #${option.organization_id}`);
                      }
                      setForm((current) => ({
                        ...current,
                        opportunity_id: String(option.id),
                        contact_id: option.contact_id ?? current.contact_id,
                        organization_id: option.organization_id ?? current.organization_id,
                        customer_name: current.customer_name.trim() ? current.customer_name : option.description?.split(" · ")[0] || option.label,
                      }));
                    }}
                    onClear={() => {
                      setDealSearch("");
                      setForm((current) => ({ ...current, opportunity_id: "" }));
                    }}
                    placeholder="Search deals"
                    queryKeyPrefix="quote-create-deal"
                    filters={{ contactId: form.contact_id, organizationId: form.organization_id }}
                  />
                </Field>
              ) : null}
            </div>
            {fieldEnabled("title") ? <Field label="Title"><Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></Field> : null}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {fieldEnabled("status") ? (
                <Field label="Status">
                  <Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{STATUSES.map((status) => <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              ) : null}
              {fieldEnabled("issue_date") ? <Field label="Issue date"><Input type="date" value={form.issue_date} onChange={(event) => setForm({ ...form, issue_date: event.target.value })} /></Field> : null}
              {fieldEnabled("expiry_date") ? <Field label="Expiry date"><Input type="date" value={form.expiry_date} onChange={(event) => setForm({ ...form, expiry_date: event.target.value })} /></Field> : null}
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
              {fieldEnabled("currency") ? <Field label="Currency"><Input value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value })} /></Field> : null}
              {fieldEnabled("subtotal_amount") ? <Field label="Subtotal"><Input type="number" step="0.01" value={form.subtotal_amount} onChange={(event) => setForm({ ...form, subtotal_amount: event.target.value })} /></Field> : null}
              {fieldEnabled("discount_amount") ? <Field label="Discount"><Input type="number" step="0.01" value={form.discount_amount} onChange={(event) => setForm({ ...form, discount_amount: event.target.value })} /></Field> : null}
              {fieldEnabled("tax_amount") ? <Field label="Tax"><Input type="number" step="0.01" value={form.tax_amount} onChange={(event) => setForm({ ...form, tax_amount: event.target.value })} /></Field> : null}
              {fieldEnabled("total_amount") ? <Field label="Total"><Input type="number" step="0.01" value={form.total_amount} onChange={(event) => setForm({ ...form, total_amount: event.target.value })} /></Field> : null}
            </div>
            {fieldEnabled("notes") ? <Field label="Notes"><Input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field> : null}
            <CustomFieldInputs definitions={customFieldsQuery.data ?? []} values={customFieldValues} onChange={(fieldKey, value) => setCustomFieldValues((current) => ({ ...current, [fieldKey]: value }))} />
          </div>
          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={closeModal}>Cancel</Button>
            <Button onClick={() => void submit()} disabled={!canSubmit || isSubmitting}>{isSubmitting ? "Creating..." : "Create"}</Button>
          </DialogFooter>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

function Field({ label, children, required = false }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div className="space-y-1">
      <Label>{label} {required ? <RequiredMark /> : null}</Label>
      {children}
    </div>
  );
}
