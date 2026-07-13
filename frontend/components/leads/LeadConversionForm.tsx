"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";

import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import { FormSection, RecordFormLayout } from "@/components/forms/RecordFormLayout";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch, SwitchThumb } from "@/components/ui/switch";
import { apiFetch } from "@/lib/api";

type LeadConversionResult = {
  account_id?: number | null;
  contact_id?: number | null;
  deal_id?: number | null;
};

const DEAL_STAGES = [
  { value: "qualified", label: "Qualified" },
  { value: "proposal", label: "Proposal" },
  { value: "negotiation", label: "Negotiation" },
  { value: "closed_won", label: "Closed Won" },
  { value: "closed_lost", label: "Closed Lost" },
];

export default function LeadConversionForm({ leadId, leadName, company }: { leadId: number; leadName: string; company?: string | null }) {
  const queryClient = useQueryClient();
  const [createAccount, setCreateAccount] = useState(true);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [accountSearch, setAccountSearch] = useState("");
  const [createContact, setCreateContact] = useState(true);
  const [contactId, setContactId] = useState<number | null>(null);
  const [contactSearch, setContactSearch] = useState("");
  const [createDeal, setCreateDeal] = useState(false);
  const [dealName, setDealName] = useState("");
  const [dealStage, setDealStage] = useState("qualified");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<LeadConversionResult | null>(null);

  const defaultDealName = useMemo(() => `${company || leadName} opportunity`, [company, leadName]);
  const accountIsValid = createAccount || Boolean(accountId);
  const contactIsValid = createContact || Boolean(contactId);
  const canSubmit = !submitting && accountIsValid && contactIsValid;

  async function submit() {
    try {
      setSubmitting(true);
      setError(null);
      const res = await apiFetch(`/sales/leads/${leadId}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          create_account: createAccount,
          account_id: createAccount ? null : accountId,
          create_contact: createContact,
          contact_id: createContact ? null : contactId,
          create_deal: createDeal,
          deal_name: createDeal ? (dealName.trim() || defaultDealName) : null,
          deal_stage: createDeal ? dealStage : null,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      setResult(body as LeadConversionResult);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-leads"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-lead-summary", String(leadId)] }),
        queryClient.invalidateQueries({ queryKey: ["sales-contacts"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-organizations"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-opportunities"] }),
      ]);
      toast.success("Lead converted.");
    } catch (conversionError) {
      setError(conversionError instanceof Error ? conversionError.message : "Failed to convert lead");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <FormSection title="Conversion complete" description="The lead is converted and the selected records are ready.">
        <div className="flex flex-wrap gap-2">
          {result.account_id ? <Button asChild variant="outline"><Link href={`/dashboard/sales/organizations/${result.account_id}`}>Open account</Link></Button> : null}
          {result.contact_id ? <Button asChild variant="outline"><Link href={`/dashboard/sales/contacts/${result.contact_id}`}>Open contact</Link></Button> : null}
          {result.deal_id ? <Button asChild variant="outline"><Link href={`/dashboard/sales/opportunities/${result.deal_id}`}>Open opportunity</Link></Button> : null}
          <Button asChild><Link href={`/dashboard/sales/leads/${leadId}`}>Return to lead</Link></Button>
        </div>
      </FormSection>
    );
  }

  return (
    <>
      {error ? <div role="alert" className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">{error}</div> : null}
      <RecordFormLayout
        sidebar={(
          <FormSection title="Conversion summary" description="Review what will happen before converting.">
            <dl className="grid gap-3 text-sm">
              <SummaryRow label="Account" value={createAccount ? "Create or reuse by name" : accountSearch || "Select an account"} />
              <SummaryRow label="Contact" value={createContact ? "Create or reuse by email" : contactSearch || "Select a contact"} />
              <SummaryRow label="Opportunity" value={createDeal ? (dealName.trim() || defaultDealName) : "Do not create"} />
            </dl>
          </FormSection>
        )}
        footer={(
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-copy-muted">This action marks the lead as converted.</span>
            <div className="flex gap-2">
              <Button asChild variant="outline"><Link href={`/dashboard/sales/leads/${leadId}`}>Cancel</Link></Button>
              <Button onClick={() => void submit()} disabled={!canSubmit}><ArrowRightLeft />{submitting ? "Converting…" : "Confirm conversion"}</Button>
            </div>
          </div>
        )}
      >
        <FormSection title="Target account" description="Create an account from the lead or link an existing account.">
          <ToggleRow label="Create account" description={company ? `Use ${company}; an existing account with the same name is reused.` : "Use the lead name when no company is present."} checked={createAccount} onCheckedChange={setCreateAccount} />
          {!createAccount ? (
            <Field className="mt-4">
              <FieldLabel>Existing account</FieldLabel>
              <LinkedRecordPicker recordType="organization" valueId={accountId} displayValue={accountSearch} onDisplayValueChange={(value) => { setAccountSearch(value); setAccountId(null); }} onSelect={(option) => { setAccountId(option.id); setAccountSearch(option.label); }} onClear={() => { setAccountId(null); setAccountSearch(""); }} placeholder="Search accounts" queryKeyPrefix="convert-lead-account" noResultsText="No accounts matched this search." />
            </Field>
          ) : null}
        </FormSection>

        <FormSection title="Target contact" description="Create a contact from the lead or link an existing contact.">
          <ToggleRow label="Create contact" description="An existing contact with the same email is reused." checked={createContact} onCheckedChange={setCreateContact} />
          {!createContact ? (
            <Field className="mt-4">
              <FieldLabel>Existing contact</FieldLabel>
              <LinkedRecordPicker recordType="contact" valueId={contactId} displayValue={contactSearch} onDisplayValueChange={(value) => { setContactSearch(value); setContactId(null); }} onSelect={(option) => { setContactId(option.id); setContactSearch(option.label); if (!createAccount && !accountId && option.organization_id) { setAccountId(option.organization_id); setAccountSearch(option.organization_name || "Linked via contact"); } }} onClear={() => { setContactId(null); setContactSearch(""); }} placeholder="Search contacts" queryKeyPrefix="convert-lead-contact" noResultsText="No contacts matched this search." />
            </Field>
          ) : null}
        </FormSection>

        <FormSection title="Opportunity" description="Optionally create an opportunity linked to the converted records.">
          <ToggleRow label="Create opportunity" description="Start a deal as part of this conversion." checked={createDeal} onCheckedChange={setCreateDeal} />
          {createDeal ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field><FieldLabel>Opportunity name</FieldLabel><Input value={dealName} onChange={(event) => setDealName(event.target.value)} placeholder={defaultDealName} /></Field>
              <Field><FieldLabel>Initial stage</FieldLabel><Select value={dealStage} onValueChange={setDealStage}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{DEAL_STAGES.map((stage) => <SelectItem key={stage.value} value={stage.value}>{stage.label}</SelectItem>)}</SelectContent></Select></Field>
            </div>
          ) : null}
        </FormSection>
      </RecordFormLayout>
    </>
  );
}

function ToggleRow({ label, description, checked, onCheckedChange }: { label: string; description: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-4 py-3">
      <div><div className="text-sm font-medium text-copy-primary">{label}</div><FieldDescription className="mt-1">{description}</FieldDescription></div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} className="relative h-6 w-11 shrink-0 rounded-full border border-line-strong bg-surface-raised data-[state=checked]:bg-action-primary"><SwitchThumb className="block h-5 w-5 rounded-full bg-white shadow-sm data-[state=checked]:translate-x-5" /></Switch>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <div className="border-b border-line-subtle pb-3 last:border-0 last:pb-0"><dt className="text-copy-muted">{label}</dt><dd className="mt-1 font-medium text-copy-primary">{value}</dd></div>;
}
