"use client";

import { useEffect, useState } from "react";

import CustomFieldInputs from "@/components/customFields/CustomFieldInputs";
import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBackdrop,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { DialogIconClose } from "@/components/ui/DialogIconClose";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCompanyCurrencies } from "@/hooks/useCompanyCurrencies";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { isModuleFieldEnabled, pickEnabledModulePayload, useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import type { Opportunity, OpportunityPayload } from "@/hooks/sales/useOpportunities";

type Props = {
  open: boolean;
  opportunity: Opportunity | null;
  isSubmitting?: boolean;
  onClose: () => void;
  onSubmit: (payload: OpportunityPayload) => Promise<void>;
};

type FormState = OpportunityPayload;

const emptyForm: FormState = {
  opportunity_name: "",
  client: "",
  sales_stage: "",
  contact_id: null,
  organization_id: null,
  assigned_to: null,
  start_date: "",
  expected_close_date: "",
  probability_percent: "",
  campaign_type: "",
  total_leads: "",
  cpl: "",
  total_cost_of_project: "",
  currency_type: "USD",
  target_geography: "",
  target_audience: "",
  domain_cap: "",
  tactics: "",
  delivery_format: "",
  attachments: [],
  custom_fields: {},
};

export default function OpportunityDialog({ open, opportunity, isSubmitting = false, onClose, onSubmit }: Props) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [contactSearch, setContactSearch] = useState("");
  const customFieldsQuery = useModuleCustomFields("sales_opportunities", open);
  const { fields: moduleFields } = useModuleFieldConfigs("sales_opportunities", false, open);
  const fieldEnabled = (fieldKey: string) => isModuleFieldEnabled(moduleFields, fieldKey);
  const currenciesQuery = useCompanyCurrencies(open);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm(
      opportunity
        ? {
            opportunity_name: opportunity.opportunity_name ?? "",
            client: opportunity.client ?? "",
            sales_stage: opportunity.sales_stage ?? "",
            contact_id: opportunity.contact_id ?? null,
            organization_id: opportunity.organization_id ?? null,
            assigned_to: opportunity.assigned_to ?? null,
            start_date: opportunity.start_date ?? "",
            expected_close_date: opportunity.expected_close_date ?? "",
            probability_percent: opportunity.probability_percent ?? "",
            campaign_type: opportunity.campaign_type ?? "",
            total_leads: opportunity.total_leads ?? "",
            cpl: opportunity.cpl ?? "",
            total_cost_of_project: opportunity.total_cost_of_project ?? "",
            currency_type: opportunity.currency_type ?? "USD",
            target_geography: opportunity.target_geography ?? "",
            target_audience: opportunity.target_audience ?? "",
            domain_cap: opportunity.domain_cap ?? "",
            tactics: opportunity.tactics ?? "",
            delivery_format: opportunity.delivery_format ?? "",
            attachments: opportunity.attachments ?? [],
            custom_fields: opportunity.custom_fields ?? {},
          }
        : emptyForm,
    );
    setError(null);
    setContactSearch(opportunity?.client ?? "");
  }, [open, opportunity]);

  async function handleSubmit() {
    try {
      setError(null);
      const payload = {
        ...form,
        probability_percent: form.probability_percent !== null && form.probability_percent !== undefined && String(form.probability_percent).trim()
          ? Number(form.probability_percent)
          : null,
      };
      await onSubmit(pickEnabledModulePayload(payload, moduleFields, ["opportunity_name", "contact_id", "custom_fields"]) as OpportunityPayload);
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to save opportunity");
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogBackdrop />
      <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
        <DialogPanel size="3xl">
          <DialogHeader>
            <DialogTitle>{opportunity ? "Edit Deal" : "Create Deal"}</DialogTitle>
            <DialogIconClose />
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {error && <div className="rounded-md border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm text-red-200">{error}</div>}

            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              {fieldEnabled("opportunity_name") ? (
              <Field>
                <FieldLabel>Deal Name <RequiredMark /></FieldLabel>
                <Input value={form.opportunity_name} onChange={(e) => setForm((c) => ({ ...c, opportunity_name: e.target.value }))} />
              </Field>
              ) : null}
              {fieldEnabled("contact_id") ? (
              <Field>
                <FieldLabel>Client Contact <RequiredMark /></FieldLabel>
                <LinkedRecordPicker
                  recordType="contact"
                  valueId={form.contact_id ?? null}
                  displayValue={contactSearch}
                  onDisplayValueChange={(value) => {
                    setContactSearch(value);
                    setForm((c) => ({
                      ...c,
                      contact_id: null,
                      organization_id: null,
                      client: value,
                    }));
                  }}
                  onSelect={(option) => {
                    setContactSearch(option.label);
                    setForm((c) => ({
                      ...c,
                      contact_id: option.id,
                      organization_id: option.organization_id ?? c.organization_id ?? null,
                      client: option.label,
                    }));
                  }}
                  onClear={() => {
                    setContactSearch("");
                    setForm((c) => ({ ...c, contact_id: null, organization_id: null, client: "" }));
                  }}
                  placeholder="Search existing contact"
                  queryKeyPrefix="opportunity-dialog-contact"
                  noResultsText="No existing contacts matched this search."
                />
                <FieldDescription>Deals must be linked to an existing sales contact.</FieldDescription>
              </Field>
              ) : null}
              {fieldEnabled("sales_stage") ? (
              <Field>
                <FieldLabel>Sales Stage</FieldLabel>
                <Input value={form.sales_stage ?? ""} onChange={(e) => setForm((c) => ({ ...c, sales_stage: e.target.value }))} />
              </Field>
              ) : null}
              {fieldEnabled("expected_close_date") ? (
              <Field>
                <FieldLabel>Expected Close Date</FieldLabel>
                <Input type="date" value={form.expected_close_date ?? ""} onChange={(e) => setForm((c) => ({ ...c, expected_close_date: e.target.value }))} />
              </Field>
              ) : null}
              {fieldEnabled("probability_percent") ? (
              <Field>
                <FieldLabel>Probability %</FieldLabel>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={form.probability_percent ?? ""}
                  onChange={(e) => setForm((c) => ({ ...c, probability_percent: e.target.value }))}
                />
              </Field>
              ) : null}
              {fieldEnabled("total_cost_of_project") ? (
              <Field>
                <FieldLabel>Total Project Cost</FieldLabel>
                <Input value={form.total_cost_of_project ?? ""} onChange={(e) => setForm((c) => ({ ...c, total_cost_of_project: e.target.value }))} />
              </Field>
              ) : null}
              {fieldEnabled("currency_type") ? (
              <Field>
                <FieldLabel>Currency</FieldLabel>
                <Select
                  value={form.currency_type ?? "USD"}
                  onValueChange={(value) => setForm((c) => ({ ...c, currency_type: value }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select currency" />
                  </SelectTrigger>
                  <SelectContent>
                    {(currenciesQuery.data ?? ["USD"]).map((currency) => (
                      <SelectItem key={currency} value={currency}>
                        {currency}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              ) : null}
              {fieldEnabled("tactics") ? (
              <Field className="sm:col-span-2">
                <FieldLabel>Tactics</FieldLabel>
                <Textarea rows={3} value={form.tactics ?? ""} onChange={(e) => setForm((c) => ({ ...c, tactics: e.target.value }))} />
              </Field>
              ) : null}
            </FieldGroup>

            {customFieldsQuery.data?.length ? (
              <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
                <CustomFieldInputs
                  definitions={customFieldsQuery.data}
                  values={(form.custom_fields as Record<string, unknown>) ?? {}}
                  onChange={(fieldKey, value) =>
                    setForm((current) => ({
                      ...current,
                      custom_fields: {
                        ...(current.custom_fields ?? {}),
                        [fieldKey]: value,
                      },
                    }))
                  }
                />
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={isSubmitting || !form.opportunity_name.trim() || !form.contact_id}>
              {isSubmitting ? "Saving..." : opportunity ? "Save Deal" : "Create Deal"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
