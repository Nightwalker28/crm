"use client";

import { useDeferredValue, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import CustomFieldInputs from "@/components/customFields/CustomFieldInputs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCompanyCurrencies } from "@/hooks/useCompanyCurrencies";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { apiFetch } from "@/lib/api";
import type { Opportunity, OpportunityPayload } from "@/hooks/sales/useOpportunities";

type Props = {
  open: boolean;
  opportunity: Opportunity | null;
  isSubmitting?: boolean;
  onClose: () => void;
  onSubmit: (payload: OpportunityPayload) => Promise<void>;
};

type FormState = OpportunityPayload;

type ContactOption = {
  contact_id: number;
  first_name?: string | null;
  last_name?: string | null;
  primary_email?: string | null;
  organization_id?: number | null;
  organization_name?: string | null;
};

const emptyForm: FormState = {
  opportunity_name: "",
  client: "",
  sales_stage: "",
  contact_id: null,
  organization_id: null,
  assigned_to: null,
  start_date: "",
  expected_close_date: "",
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

async function fetchContactOptions(search: string): Promise<ContactOption[]> {
  const params = new URLSearchParams({
    page: "1",
    page_size: "10",
    query: search,
  });

  const res = await apiFetch(`/sales/contacts/search?${params.toString()}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Failed with ${res.status}`);
  }

  const body = await res.json().catch(() => ({ results: [] }));
  return Array.isArray(body?.results) ? body.results : [];
}

function getContactDisplay(option: ContactOption): string {
  return `${option.first_name ?? ""} ${option.last_name ?? ""}`.trim() || option.primary_email || "Unnamed contact";
}

function RequiredAsterisk() {
  return <span className="text-red-400">*</span>;
}

export default function OpportunityDialog({ open, opportunity, isSubmitting = false, onClose, onSubmit }: Props) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [contactSearch, setContactSearch] = useState("");
  const [isContactDropdownOpen, setIsContactDropdownOpen] = useState(false);
  const deferredContactSearch = useDeferredValue(contactSearch.trim());
  const customFieldsQuery = useModuleCustomFields("sales_opportunities", open);
  const currenciesQuery = useCompanyCurrencies(open);
  const contactQuery = useQuery({
    queryKey: ["opportunity-contact-options", deferredContactSearch],
    queryFn: () => fetchContactOptions(deferredContactSearch),
    enabled: open && deferredContactSearch.length > 0,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!open) return;
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
    setIsContactDropdownOpen(false);
  }, [open, opportunity]);

  async function handleSubmit() {
    try {
      setError(null);
      await onSubmit(form);
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to save opportunity");
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogBackdrop />
      <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-3xl">
          <DialogHeader>
            <DialogTitle>{opportunity ? "Edit Opportunity" : "Create Opportunity"}</DialogTitle>
            <DialogClose className="cursor-pointer text-neutral-400/70 hover:text-red-400/90">
              Close
            </DialogClose>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {error && <div className="rounded-md border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm text-red-200">{error}</div>}

            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel>Opportunity Name <RequiredAsterisk /></FieldLabel>
                <Input value={form.opportunity_name} onChange={(e) => setForm((c) => ({ ...c, opportunity_name: e.target.value }))} />
              </Field>
              <Field>
                <FieldLabel>Client Contact <RequiredAsterisk /></FieldLabel>
                <div className="relative">
                  <Input
                    value={contactSearch}
                    onFocus={() => setIsContactDropdownOpen(true)}
                    onBlur={() => {
                      window.setTimeout(() => setIsContactDropdownOpen(false), 120);
                    }}
                    onChange={(e) => {
                      const value = e.target.value;
                      setContactSearch(value);
                      setForm((c) => ({
                        ...c,
                        contact_id: null,
                        organization_id: null,
                        client: value,
                      }));
                    }}
                    placeholder="Search existing contact"
                  />

                  {isContactDropdownOpen && deferredContactSearch ? (
                    <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-20 rounded-md border border-neutral-800 bg-neutral-950 shadow-2xl">
                      {contactQuery.isLoading ? (
                        <div className="px-3 py-2 text-sm text-neutral-500">Searching contacts…</div>
                      ) : contactQuery.error ? (
                        <div className="px-3 py-2 text-sm text-red-300">
                          {contactQuery.error instanceof Error ? contactQuery.error.message : "Failed to search contacts."}
                        </div>
                      ) : (contactQuery.data ?? []).length ? (
                        <div className="max-h-56 overflow-y-auto py-1">
                          {(contactQuery.data ?? []).map((option) => (
                            <button
                              key={option.contact_id}
                              type="button"
                              className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-neutral-900"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => {
                                const display = getContactDisplay(option);
                                setContactSearch(display);
                                setForm((c) => ({
                                  ...c,
                                  contact_id: option.contact_id,
                                  organization_id: option.organization_id ?? c.organization_id ?? null,
                                  client: display,
                                }));
                                setIsContactDropdownOpen(false);
                              }}
                            >
                              <span className="text-sm text-neutral-100">{getContactDisplay(option)}</span>
                              <span className="text-xs text-neutral-500">
                                {option.organization_name || option.primary_email || "Existing contact"}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="px-3 py-2 text-sm text-neutral-500">No existing contacts matched this search.</div>
                      )}
                    </div>
                  ) : null}
                </div>
                <FieldDescription>Opportunities must be linked to an existing sales contact.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel>Sales Stage</FieldLabel>
                <Input value={form.sales_stage ?? ""} onChange={(e) => setForm((c) => ({ ...c, sales_stage: e.target.value }))} />
              </Field>
              <Field>
                <FieldLabel>Expected Close Date</FieldLabel>
                <Input type="date" value={form.expected_close_date ?? ""} onChange={(e) => setForm((c) => ({ ...c, expected_close_date: e.target.value }))} />
              </Field>
              <Field>
                <FieldLabel>Total Project Cost</FieldLabel>
                <Input value={form.total_cost_of_project ?? ""} onChange={(e) => setForm((c) => ({ ...c, total_cost_of_project: e.target.value }))} />
              </Field>
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
              <Field className="sm:col-span-2">
                <FieldLabel>Tactics</FieldLabel>
                <Textarea rows={3} value={form.tactics ?? ""} onChange={(e) => setForm((c) => ({ ...c, tactics: e.target.value }))} />
              </Field>
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
              {isSubmitting ? "Saving..." : opportunity ? "Save Opportunity" : "Create Opportunity"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
