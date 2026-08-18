"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";

import LinkedRecordPicker, { type LinkedRecordOption } from "@/components/crm/LinkedRecordPicker";
import { FormSection, RecordFormLayout } from "@/components/forms/RecordFormLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { RouteErrorState, RouteLoadingState } from "@/components/ui/RouteStates";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Contract } from "@/hooks/contracts/useContracts";
import {
  isModuleFieldEnabled,
  pickEnabledModulePayload,
  useModuleFieldConfigs,
} from "@/hooks/useModuleFieldConfigs";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";

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
  quote_id: number | null;
  order_id: number | null;
  document_id: number | null;
  owner_id: number | null;
};

const EMPTY_FORM: ContractForm = {
  title: "",
  status: "draft",
  value_amount: "",
  currency: "USD",
  effective_date: "",
  expiration_date: "",
  renewal_date: "",
  contact_id: null,
  organization_id: null,
  opportunity_id: null,
  quote_id: null,
  order_id: null,
  document_id: null,
  owner_id: null,
};

type ContractResponse = {
  id: number;
};

type ContractDisplays = {
  contact: string;
  organization: string;
  opportunity: string;
  quote: string;
  order: string;
  document: string;
  owner: string;
};

const EMPTY_DISPLAYS: ContractDisplays = {
  contact: "",
  organization: "",
  opportunity: "",
  quote: "",
  order: "",
  document: "",
  owner: "",
};

type ContractSeed = {
  form: ContractForm;
  displays: ContractDisplays;
};

function optionalDecimal(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

async function fetchContractForEdit(contractId: string) {
  const res = await apiFetch(`/contracts/${contractId}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error("We could not load this contract.");
  return body as Contract;
}

function contractSeed(contract?: Contract): ContractSeed {
  if (!contract) return { form: EMPTY_FORM, displays: EMPTY_DISPLAYS };
  return {
    form: {
      title: contract.title ?? "",
      status: contract.status ?? "draft",
      value_amount: contract.value_amount == null ? "" : String(contract.value_amount),
      currency: contract.currency ?? "USD",
      effective_date: contract.effective_date ?? "",
      expiration_date: contract.expiration_date ?? "",
      renewal_date: contract.renewal_date ?? "",
      contact_id: contract.contact_id,
      organization_id: contract.organization_id,
      opportunity_id: contract.opportunity_id,
      quote_id: contract.quote_id,
      order_id: contract.order_id,
      document_id: contract.document_id,
      owner_id: contract.owner_id,
    },
    displays: {
      contact: contract.contact_id ? `Contact #${contract.contact_id}` : "",
      organization: contract.organization_id ? `Account #${contract.organization_id}` : "",
      opportunity: contract.opportunity_id ? `Deal #${contract.opportunity_id}` : "",
      quote: contract.quote_id ? `Quote #${contract.quote_id}` : "",
      order: contract.order_id ? `Order #${contract.order_id}` : "",
      document: contract.document_id ? `Document #${contract.document_id}` : "",
      owner: contract.owner_id ? `User #${contract.owner_id}` : "",
    },
  };
}

export default function ContractRecordFormPage({
  mode = "create",
  contractId,
}: {
  mode?: "create" | "edit";
  contractId?: string;
}) {
  const query = useQuery({
    queryKey: ["contract-edit", contractId],
    queryFn: () => fetchContractForEdit(contractId as string),
    enabled: mode === "edit" && Boolean(contractId),
    staleTime: 30_000,
  });
  if (mode === "edit" && query.isLoading) return <RouteLoadingState label="contract" />;
  if (mode === "edit" && query.error) {
    return (
      <RouteErrorState
        title="Unable to load contract"
        reset={() => void query.refetch()}
        backHref="/dashboard/contracts"
        backLabel="Back to contracts"
      />
    );
  }
  const seed = contractSeed(query.data);
  return (
    <ContractRecordFormEditor
      key={`${mode}:${contractId ?? "new"}:${query.data?.updated_at ?? ""}`}
      mode={mode}
      contractId={contractId}
      seed={seed}
      contractNumber={query.data?.contract_number}
      updatedAt={query.data?.updated_at}
    />
  );
}

function ContractRecordFormEditor({
  mode,
  contractId,
  seed,
  contractNumber,
  updatedAt,
}: {
  mode: "create" | "edit";
  contractId?: string;
  seed: ContractSeed;
  contractNumber?: string;
  updatedAt?: string | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { fields: moduleFields } = useModuleFieldConfigs("contracts");
  const [form, setForm] = useState<ContractForm>(seed.form);
  const [displays, setDisplays] = useState<ContractDisplays>(seed.displays);
  const [initialSnapshot] = useState(() => JSON.stringify([seed.form, seed.displays]));
  const [titleError, setTitleError] = useState<string | null>(null);
  const [valueError, setValueError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const currentSnapshot = useMemo(() => JSON.stringify([form, displays]), [displays, form]);
  const isDirty = currentSnapshot !== initialSnapshot;
  const enabled = (fieldKey: string) => isModuleFieldEnabled(moduleFields, fieldKey);

  useUnsavedChangesGuard(isDirty, submitting);

  function updateDisplay(key: keyof typeof displays, value: string) {
    setDisplays((current) => ({ ...current, [key]: value }));
  }

  function clearChildren(parent: "organization" | "contact" | "opportunity" | "quote") {
    if (parent === "organization") {
      setForm((current) => ({ ...current, contact_id: null, opportunity_id: null, quote_id: null, order_id: null, document_id: null }));
      setDisplays((current) => ({ ...current, contact: "", opportunity: "", quote: "", order: "", document: "" }));
    } else if (parent === "contact") {
      setForm((current) => ({ ...current, opportunity_id: null, quote_id: null, order_id: null, document_id: null }));
      setDisplays((current) => ({ ...current, opportunity: "", quote: "", order: "", document: "" }));
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

  function validate() {
    const nextTitleError = form.title.trim() ? null : "Title is required.";
    const nextValueError = optionalDecimal(form.value_amount) === null ? "Enter a value of zero or greater." : null;
    const nextDateError = form.effective_date && form.expiration_date && form.expiration_date < form.effective_date
      ? "Expiration date cannot be before the effective date."
      : null;
    setTitleError(nextTitleError);
    setValueError(nextValueError);
    setDateError(nextDateError);

    if (nextTitleError) document.getElementById("contract-title")?.focus();
    else if (nextValueError) document.getElementById("contract-value")?.focus();
    else if (nextDateError) document.getElementById("contract-expiration-date")?.focus();
    return !nextTitleError && !nextValueError && !nextDateError;
  }

  async function submit() {
    if (submitting || !validate()) return;
    try {
      setSubmitting(true);
      setSubmitError(false);
      const payload = pickEnabledModulePayload(
        {
          title: form.title.trim(),
          status: form.status,
          value_amount: optionalDecimal(form.value_amount) ?? null,
          currency: form.currency.trim().toUpperCase() || null,
          effective_date: form.effective_date || null,
          expiration_date: form.expiration_date || null,
          renewal_date: form.renewal_date || null,
          contact_id: form.contact_id,
          organization_id: form.organization_id,
          opportunity_id: form.opportunity_id,
          quote_id: form.quote_id,
          order_id: form.order_id,
          document_id: form.document_id,
          owner_id: form.owner_id,
        },
        moduleFields,
        ["title"],
      );
      const res = await apiFetch(mode === "edit" ? `/contracts/${contractId}` : "/contracts", {
        method: mode === "edit" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null) as ContractResponse | null;
      if (!res.ok || !body?.id) throw new Error("Contract creation failed");
      const savedContractId = body.id ?? (contractId ? Number(contractId) : null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["contracts"] }),
        queryClient.invalidateQueries({ queryKey: ["contract", String(savedContractId)] }),
        queryClient.invalidateQueries({ queryKey: ["contract-edit", String(savedContractId)] }),
      ]);
      toast.success(mode === "edit" ? "Contract updated." : "Contract created.");
      router.push(savedContractId ? `/dashboard/contracts/${savedContractId}` : "/dashboard/contracts");
    } catch {
      setSubmitError(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageShell
      eyebrow={mode === "edit" && updatedAt ? `Last modified ${formatDateTime(updatedAt)}` : undefined}
      title={mode === "edit" ? `Edit ${contractNumber ?? "contract"}` : "Create contract"}
      description={mode === "edit" ? "Update the commercial terms, lifecycle dates, ownership, and CRM relationships." : "Set the commercial terms, lifecycle dates, ownership, and related CRM records."}
      actions={<Button asChild variant="ghost" size="sm"><Link href={mode === "edit" && contractId ? `/dashboard/contracts/${contractId}` : "/dashboard/contracts"}><ArrowLeft />Back to {mode === "edit" ? "contract" : "contracts"}</Link></Button>}
    >
      {submitError ? (
        <div role="alert" className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
          <div className="font-medium">We could not {mode === "edit" ? "update" : "create"} this contract.</div>
          <div className="mt-1 text-copy-secondary">Check the entered information and try again.</div>
        </div>
      ) : null}

      <RecordFormLayout
        sidebar={
          <Card className="p-5">
            <h2 className="text-base font-semibold text-copy-primary">Lifecycle and ownership</h2>
            <FieldDescription className="mt-1">Set who owns the contract and its current stage.</FieldDescription>
            <FieldGroup className="mt-5">
              {enabled("status") ? (
                <Field>
                  <FieldLabel>Status</FieldLabel>
                  <Select value={form.status} onValueChange={(status) => setForm((current) => ({ ...current, status }))}>
                    <SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger>
                    <SelectContent>{STATUSES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              ) : null}
              {enabled("owner_id") ? (
                <Field>
                  <FieldLabel>Owner</FieldLabel>
                  <LinkedRecordPicker recordType="user" valueId={form.owner_id} displayValue={displays.owner} onDisplayValueChange={(value) => { updateDisplay("owner", value); setForm((current) => ({ ...current, owner_id: null })); }} onSelect={(option) => { updateDisplay("owner", option.label); setForm((current) => ({ ...current, owner_id: option.id })); }} onClear={() => { updateDisplay("owner", ""); setForm((current) => ({ ...current, owner_id: null })); }} placeholder="Search owners" queryKeyPrefix="contract-owner" sourceModuleKey="contracts" sourceAction={mode === "edit" ? "edit" : "create"} />
                </Field>
              ) : null}
            </FieldGroup>
          </Card>
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-copy-muted">{isDirty ? "You have unsaved changes." : mode === "edit" ? "No unsaved changes." : "Complete the required fields to create this contract."}</span>
            <div className="flex items-center gap-2">
              <Button asChild variant="outline"><Link href={mode === "edit" && contractId ? `/dashboard/contracts/${contractId}` : "/dashboard/contracts"}>Cancel</Link></Button>
              <Button onClick={() => void submit()} disabled={submitting || (mode === "edit" && !isDirty)}><Save />{submitting ? "Saving…" : mode === "edit" ? "Save changes" : "Create contract"}</Button>
            </div>
          </div>
        }
      >
        <FormSection title="Contract details" description={mode === "edit" ? "The contract number remains fixed while its commercial details can be updated." : "The contract number is generated automatically after creation."}>
          <FieldGroup className="grid gap-4 md:grid-cols-2">
            <Field className="md:col-span-2">
              <FieldLabel htmlFor="contract-title">Title <RequiredMark /></FieldLabel>
              <Input id="contract-title" value={form.title} onChange={(event) => { setForm((current) => ({ ...current, title: event.target.value })); if (titleError) setTitleError(null); }} aria-invalid={Boolean(titleError)} aria-describedby={titleError ? "contract-title-error" : undefined} placeholder="Annual services agreement" />
              {titleError ? <FieldError id="contract-title-error">{titleError}</FieldError> : null}
            </Field>
            {enabled("value_amount") ? (
              <Field>
                <FieldLabel htmlFor="contract-value">Value</FieldLabel>
                <Input id="contract-value" type="number" min="0" step="0.01" value={form.value_amount} onChange={(event) => { setForm((current) => ({ ...current, value_amount: event.target.value })); if (valueError) setValueError(null); }} aria-invalid={Boolean(valueError)} aria-describedby={valueError ? "contract-value-error" : undefined} />
                {valueError ? <FieldError id="contract-value-error">{valueError}</FieldError> : null}
              </Field>
            ) : null}
            {enabled("currency") ? (
              <Field>
                <FieldLabel htmlFor="contract-currency">Currency</FieldLabel>
                <Input id="contract-currency" value={form.currency} onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))} maxLength={10} placeholder="USD" />
              </Field>
            ) : null}
          </FieldGroup>
        </FormSection>

        {(enabled("effective_date") || enabled("expiration_date") || enabled("renewal_date")) ? (
          <FormSection title="Key dates" description="Track the effective period and upcoming renewal window.">
            <FieldGroup className="grid gap-4 md:grid-cols-3">
              {enabled("effective_date") ? (
                <Field>
                  <FieldLabel htmlFor="contract-effective-date">Effective date</FieldLabel>
                  <Input id="contract-effective-date" type="date" value={form.effective_date} onChange={(event) => { setForm((current) => ({ ...current, effective_date: event.target.value })); if (dateError) setDateError(null); }} />
                </Field>
              ) : null}
              {enabled("expiration_date") ? (
                <Field>
                  <FieldLabel htmlFor="contract-expiration-date">Expiration date</FieldLabel>
                  <Input id="contract-expiration-date" type="date" value={form.expiration_date} onChange={(event) => { setForm((current) => ({ ...current, expiration_date: event.target.value })); if (dateError) setDateError(null); }} aria-invalid={Boolean(dateError)} aria-describedby={dateError ? "contract-date-error" : undefined} />
                  {dateError ? <FieldError id="contract-date-error">{dateError}</FieldError> : null}
                </Field>
              ) : null}
              {enabled("renewal_date") ? (
                <Field>
                  <FieldLabel htmlFor="contract-renewal-date">Renewal date</FieldLabel>
                  <Input id="contract-renewal-date" type="date" value={form.renewal_date} onChange={(event) => setForm((current) => ({ ...current, renewal_date: event.target.value }))} />
                </Field>
              ) : null}
            </FieldGroup>
          </FormSection>
        ) : null}

        <FormSection title="Related records" description="Search by name or record number. Changing a parent record clears incompatible child links.">
          <FieldGroup className="grid gap-4 md:grid-cols-2">
            {enabled("organization_id") ? (
              <Field>
                <FieldLabel>Account</FieldLabel>
                <LinkedRecordPicker recordType="organization" valueId={form.organization_id} displayValue={displays.organization} onDisplayValueChange={(value) => { updateDisplay("organization", value); setForm((current) => ({ ...current, organization_id: null })); clearChildren("organization"); }} onSelect={(option) => { clearChildren("organization"); setForm((current) => ({ ...current, organization_id: option.organization_id ?? option.id })); updateDisplay("organization", option.label); }} onClear={() => { setForm((current) => ({ ...current, organization_id: null })); updateDisplay("organization", ""); clearChildren("organization"); }} placeholder="Search accounts" queryKeyPrefix="contract-account" />
              </Field>
            ) : null}
            {enabled("contact_id") ? (
              <Field>
                <FieldLabel>Contact</FieldLabel>
                <LinkedRecordPicker recordType="contact" valueId={form.contact_id} displayValue={displays.contact} onDisplayValueChange={(value) => { updateDisplay("contact", value); setForm((current) => ({ ...current, contact_id: null })); clearChildren("contact"); }} onSelect={selectContact} onClear={() => { setForm((current) => ({ ...current, contact_id: null })); updateDisplay("contact", ""); clearChildren("contact"); }} placeholder="Search contacts" queryKeyPrefix="contract-contact" filters={{ organizationId: form.organization_id }} />
              </Field>
            ) : null}
            {enabled("opportunity_id") ? (
              <Field>
                <FieldLabel>Deal</FieldLabel>
                <LinkedRecordPicker recordType="opportunity" valueId={form.opportunity_id} displayValue={displays.opportunity} onDisplayValueChange={(value) => { updateDisplay("opportunity", value); setForm((current) => ({ ...current, opportunity_id: null })); clearChildren("opportunity"); }} onSelect={selectOpportunity} onClear={() => { setForm((current) => ({ ...current, opportunity_id: null })); updateDisplay("opportunity", ""); clearChildren("opportunity"); }} placeholder="Search deals" queryKeyPrefix="contract-deal" filters={{ contactId: form.contact_id, organizationId: form.organization_id }} />
              </Field>
            ) : null}
            {enabled("quote_id") ? (
              <Field>
                <FieldLabel>Quote</FieldLabel>
                <LinkedRecordPicker recordType="quote" valueId={form.quote_id} displayValue={displays.quote} onDisplayValueChange={(value) => { updateDisplay("quote", value); setForm((current) => ({ ...current, quote_id: null })); clearChildren("quote"); }} onSelect={(option) => { updateDisplay("quote", option.label); setForm((current) => ({ ...current, quote_id: option.id, order_id: null })); clearChildren("quote"); }} onClear={() => { updateDisplay("quote", ""); setForm((current) => ({ ...current, quote_id: null })); clearChildren("quote"); }} placeholder="Search quotes" queryKeyPrefix="contract-quote" filters={{ contactId: form.contact_id, organizationId: form.organization_id, opportunityId: form.opportunity_id }} />
              </Field>
            ) : null}
            {enabled("order_id") ? (
              <Field>
                <FieldLabel>Order</FieldLabel>
                <LinkedRecordPicker recordType="order" valueId={form.order_id} displayValue={displays.order} onDisplayValueChange={(value) => { updateDisplay("order", value); setForm((current) => ({ ...current, order_id: null })); }} onSelect={(option) => { updateDisplay("order", option.label); setForm((current) => ({ ...current, order_id: option.id })); }} onClear={() => { updateDisplay("order", ""); setForm((current) => ({ ...current, order_id: null })); }} placeholder="Search orders" queryKeyPrefix="contract-order" filters={{ contactId: form.contact_id, organizationId: form.organization_id, opportunityId: form.opportunity_id, quoteId: form.quote_id }} />
              </Field>
            ) : null}
            {enabled("document_id") ? (
              <Field>
                <FieldLabel>Document</FieldLabel>
                <LinkedRecordPicker recordType="document" valueId={form.document_id} displayValue={displays.document} onDisplayValueChange={(value) => { updateDisplay("document", value); setForm((current) => ({ ...current, document_id: null })); }} onSelect={(option) => { updateDisplay("document", option.label); setForm((current) => ({ ...current, document_id: option.id })); }} onClear={() => { updateDisplay("document", ""); setForm((current) => ({ ...current, document_id: null })); }} placeholder="Search documents" queryKeyPrefix="contract-document" linkedModuleKey={form.contact_id ? "sales_contacts" : form.organization_id ? "sales_organizations" : undefined} linkedEntityId={form.contact_id ?? form.organization_id} />
              </Field>
            ) : null}
          </FieldGroup>
        </FormSection>
      </RecordFormLayout>
    </PageShell>
  );
}
