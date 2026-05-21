"use client";

import { useEffect, useMemo, useState } from "react";

import CustomFieldInputs from "@/components/customFields/CustomFieldInputs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBackdrop, DialogFooter, DialogHeader, DialogPanel, DialogTitle } from "@/components/ui/dialog";
import { DialogIconClose } from "@/components/ui/DialogIconClose";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiFetch } from "@/lib/api";
import { isModuleFieldEnabled, pickEnabledModulePayload, useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";

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

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

export default function CreateLeadModal({ isOpen, onClose, onSuccess }: Props) {
  const [form, setForm] = useState<LeadForm>(emptyForm);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const customFieldsQuery = useModuleCustomFields("sales_leads", isOpen);
  const { fields: moduleFields } = useModuleFieldConfigs("sales_leads", false, isOpen);
  const fieldEnabled = (fieldKey: string) => isModuleFieldEnabled(moduleFields, fieldKey);
  const canSubmit = useMemo(() => Boolean(form.primary_email.trim()), [form.primary_email]);

  useEffect(() => {
    if (!isOpen) return;
    setForm(emptyForm);
    setCustomFieldValues({});
    setError(null);
  }, [isOpen]);

  function closeModal() {
    setForm(emptyForm);
    setCustomFieldValues({});
    setError(null);
    onClose();
  }

  async function submit() {
    try {
      setIsSubmitting(true);
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
      const res = await apiFetch("/sales/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      onSuccess();
      closeModal();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create lead");
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
            <DialogTitle>Create Lead</DialogTitle>
            <DialogIconClose />
          </DialogHeader>
          <div className="mt-4 space-y-4">
            {error ? <p className="text-sm text-red-400">{error}</p> : null}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {fieldEnabled("first_name") ? <Field label="First name"><Input value={form.first_name} onChange={(event) => setForm({ ...form, first_name: event.target.value })} /></Field> : null}
              {fieldEnabled("last_name") ? <Field label="Last name"><Input value={form.last_name} onChange={(event) => setForm({ ...form, last_name: event.target.value })} /></Field> : null}
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {fieldEnabled("primary_email") ? <Field label="Email" required><Input type="email" value={form.primary_email} onChange={(event) => setForm({ ...form, primary_email: event.target.value })} placeholder="person@company.com" /></Field> : null}
              {fieldEnabled("phone") ? <Field label="Phone"><Input type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></Field> : null}
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {fieldEnabled("company") ? <Field label="Company"><Input value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} /></Field> : null}
              {fieldEnabled("title") ? <Field label="Job title"><Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></Field> : null}
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {fieldEnabled("source") ? <Field label="Source"><Input value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} /></Field> : null}
              {fieldEnabled("status") ? (
                <Field label="Status">
                  <Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((status) => <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
            </div>
            {fieldEnabled("notes") ? <Field label="Notes"><Input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field> : null}
            <CustomFieldInputs
              definitions={customFieldsQuery.data ?? []}
              values={customFieldValues}
              onChange={(fieldKey, value) => setCustomFieldValues((current) => ({ ...current, [fieldKey]: value }))}
            />
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
