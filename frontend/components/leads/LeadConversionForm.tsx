"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";

import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import { FormErrorBanner } from "@/components/forms/FormErrorBanner";
import { FormSection, RecordFormLayout } from "@/components/forms/RecordFormLayout";
import { OpportunityStageSelect } from "@/components/opportunities/OpportunityStageSelect";
import { orderedStages } from "@/components/opportunities/opportunityStages";
import { useRecordTabHref } from "@/components/recordWorkspace/RecordWorkspace";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SegmentedBoolean } from "@/components/ui/SegmentedControl";
import { TextLink } from "@/components/ui/TextLink";
import { useOpportunityPipeline } from "@/hooks/sales/useOpportunityPipeline";
import { useCompanyCurrencies } from "@/hooks/useCompanyCurrencies";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { apiFetch } from "@/lib/api";
import { apiErrorFromBody, formErrorMessage } from "@/lib/apiErrors";

type LeadConversionResult = {
  account_id?: number | null;
  contact_id?: number | null;
  deal_id?: number | null;
  created_account?: boolean;
  created_contact?: boolean;
  created_deal?: boolean;
};

export type LeadConversionCapabilities = {
  canViewOrganizations: boolean;
  canCreateOrganizations: boolean;
  canViewContacts: boolean;
  canCreateContacts: boolean;
  canCreateOpportunities: boolean;
};

export default function LeadConversionForm({
  leadId,
  leadName,
  company,
  capabilities,
  onConverted,
}: {
  leadId: number;
  leadName: string;
  company?: string | null;
  capabilities: LeadConversionCapabilities;
  /** Lets the page keep this form's result screen once the lead reads as converted. */
  onConverted?: () => void;
}) {
  const queryClient = useQueryClient();
  const [createAccount, setCreateAccount] = useState(capabilities.canCreateOrganizations);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [accountSearch, setAccountSearch] = useState("");
  const [createContact, setCreateContact] = useState(capabilities.canCreateContacts);
  const [contactId, setContactId] = useState<number | null>(null);
  const [contactSearch, setContactSearch] = useState("");
  // H11: a qualified lead usually becomes a deal, so the deal is on by default, as it is in
  // Salesforce's Convert and Dynamics 365's Qualify.
  const [createDeal, setCreateDeal] = useState(capabilities.canCreateOpportunities);
  const [dealName, setDealName] = useState("");
  const [dealStage, setDealStage] = useState("");
  const [dealAmount, setDealAmount] = useState("");
  const [dealCurrency, setDealCurrency] = useState("");
  const [dealCloseDate, setDealCloseDate] = useState("");
  const currenciesQuery = useCompanyCurrencies(capabilities.canCreateOpportunities);
  const currencies = currenciesQuery.data ?? [];
  const effectiveDealCurrency = dealCurrency || currencies[0] || "";
  const pipelineQuery = useOpportunityPipeline();
  // A converted lead is already qualified, so a new deal starts at the first stage in active
  // pursuit rather than at the pipeline's entry stage.
  const initialDealStage =
    orderedStages(pipelineQuery.data).find((stage) => stage.is_active && stage.semantic_type === "ongoing")?.key ?? "";
  const effectiveDealStage = dealStage || initialDealStage;
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<LeadConversionResult | null>(null);

  const recordHref = useRecordTabHref(`/dashboard/sales/leads/${leadId}`);

  // A13. Conversion is a form that creates up to three records, and it was the one form in
  // the app with no guard on it — Cancel, the header's `Back to lead` and the sidebar's own
  // links all discarded a filled-in conversion silently. The dirty test is a snapshot
  // against the state the page opened in, so the defaults the operator never touched do not
  // count as work: arriving and leaving costs no prompt.
  const initialSnapshot = useMemo(
    () => JSON.stringify([capabilities.canCreateOrganizations, null, "", capabilities.canCreateContacts, null, "", capabilities.canCreateOpportunities, "", "", "", "", ""]),
    [capabilities.canCreateContacts, capabilities.canCreateOpportunities, capabilities.canCreateOrganizations],
  );
  const currentSnapshot = useMemo(
    () => JSON.stringify([createAccount, accountId, accountSearch, createContact, contactId, contactSearch, createDeal, dealName, dealStage, dealAmount, dealCurrency, dealCloseDate]),
    [accountId, accountSearch, contactId, contactSearch, createAccount, createContact, createDeal, dealAmount, dealCloseDate, dealCurrency, dealName, dealStage],
  );
  // The guard lifts once the conversion has run: the records exist, so the completion panel's
  // links are the operator's next step rather than an escape from unsaved work.
  useUnsavedChangesGuard(currentSnapshot !== initialSnapshot, submitting || Boolean(result));

  const defaultDealName = useMemo(() => `${company || leadName} deal`, [company, leadName]);
  const shouldCreateAccount = capabilities.canCreateOrganizations && createAccount;
  const shouldCreateContact = capabilities.canCreateContacts && createContact;
  const shouldCreateDeal = capabilities.canCreateOpportunities && createDeal;
  const accountIsValid = shouldCreateAccount || (capabilities.canViewOrganizations && Boolean(accountId));
  const contactIsValid = shouldCreateContact || (capabilities.canViewContacts && Boolean(contactId));
  const amountError = shouldCreateDeal && dealAmount.trim() && !(Number(dealAmount) >= 0) ? "Enter an amount of zero or more." : null;
  const canSubmit = !submitting && accountIsValid && contactIsValid && !amountError;

  async function submit() {
    try {
      setSubmitting(true);
      setError(null);
      const res = await apiFetch(`/sales/leads/${leadId}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          create_account: shouldCreateAccount,
          account_id: shouldCreateAccount ? null : accountId,
          create_contact: shouldCreateContact,
          contact_id: shouldCreateContact ? null : contactId,
          create_deal: shouldCreateDeal,
          deal_name: shouldCreateDeal ? (dealName.trim() || defaultDealName) : null,
          deal_stage: shouldCreateDeal ? effectiveDealStage || null : null,
          deal_amount: shouldCreateDeal && dealAmount.trim() ? dealAmount.trim() : null,
          deal_currency: shouldCreateDeal ? effectiveDealCurrency || null : null,
          deal_close_date: shouldCreateDeal ? dealCloseDate || null : null,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw apiErrorFromBody(res.status, body, "Review the selected records and try again.");
      onConverted?.();
      setResult(body as LeadConversionResult);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-leads"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-lead-summary", String(leadId)] }),
        queryClient.invalidateQueries({ queryKey: ["sales-contacts"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-organizations"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-opportunities"] }),
      ]);
      toast.success("Lead converted.");
    } catch (failure) {
      setError(formErrorMessage(failure, "Review the selected records and try again."));
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    const outcomes = [
      { id: result.account_id, created: result.created_account, noun: "account", href: "/dashboard/sales/organizations" },
      { id: result.contact_id, created: result.created_contact, noun: "contact", href: "/dashboard/sales/contacts" },
      { id: result.deal_id, created: result.created_deal, noun: "deal", href: "/dashboard/sales/opportunities" },
    ].filter((outcome) => outcome.id);
    return (
      <FormSection title="Lead converted" description={`${leadName} is now a customer record. Each record's timeline shows where it came from.`}>
        <ul className="grid gap-2 text-sm" aria-label="Records from this conversion">
          {outcomes.map((outcome) => (
            <li key={outcome.noun} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-copy-secondary">{outcome.created ? `New ${outcome.noun}` : `Existing ${outcome.noun} linked`}</span>
              <TextLink href={`${outcome.href}/${outcome.id}`}>Open {outcome.noun}</TextLink>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          {result.deal_id ? <Button asChild><Link href={`/dashboard/sales/opportunities/${result.deal_id}`}>Open deal</Link></Button> : null}
          <Button asChild variant={result.deal_id ? "outline" : "default"}><Link href={recordHref}>Return to lead</Link></Button>
        </div>
      </FormSection>
    );
  }

  return (
    <>
      {error ? <FormErrorBanner title="We could not convert this lead.">{error}</FormErrorBanner> : null}
      <RecordFormLayout
        title={leadName}
        sidebar={(
          <FormSection title="Conversion summary" description="Review what will happen before converting.">
            <dl className="grid gap-3 text-sm">
              <SummaryRow label="Account" value={shouldCreateAccount ? "Create or reuse by name" : accountSearch || "Select an account"} />
              <SummaryRow label="Contact" value={shouldCreateContact ? "Create or reuse by email" : contactSearch || "Select a contact"} />
              <SummaryRow label="Deal" value={shouldCreateDeal ? (dealName.trim() || defaultDealName) : "Do not create"} />
            </dl>
          </FormSection>
        )}
        status="This action marks the lead as converted."
        actions={(
          <>
            <Button asChild variant="outline"><Link href={recordHref}>Cancel</Link></Button>
            <Button onClick={() => void submit()} disabled={!canSubmit}><ArrowRightLeft />{submitting ? "Converting…" : "Confirm conversion"}</Button>
          </>
        )}
      >
        <FormSection title="Target account" description="Create an account from the lead or link an existing account.">
          <ToggleRow
            label="Create account"
            description={capabilities.canCreateOrganizations
              ? (company ? `Use ${company}; an existing account with the same name is reused.` : "Use the lead name when no company is present.")
              : "Account creation is unavailable with your current permissions."}
            checked={shouldCreateAccount}
            disabled={!capabilities.canCreateOrganizations || !capabilities.canViewOrganizations}
            onCheckedChange={setCreateAccount}
          />
          {!shouldCreateAccount && capabilities.canViewOrganizations ? (
            <Field className="mt-4">
              <FieldLabel htmlFor="lead-conversion-existing-account">Existing account</FieldLabel>
              <LinkedRecordPicker inputId="lead-conversion-existing-account" recordType="organization" valueId={accountId} displayValue={accountSearch} onDisplayValueChange={(value) => { setAccountSearch(value); setAccountId(null); }} onSelect={(option) => { setAccountId(option.id); setAccountSearch(option.label); }} onClear={() => { setAccountId(null); setAccountSearch(""); }} placeholder="Search accounts" queryKeyPrefix="convert-lead-account" noResultsText="No accounts matched this search." />
            </Field>
          ) : null}
        </FormSection>

        <FormSection title="Target contact" description="Create a contact from the lead or link an existing contact.">
          <ToggleRow
            label="Create contact"
            description={capabilities.canCreateContacts
              ? "An existing contact with the same email is reused."
              : "Contact creation is unavailable with your current permissions."}
            checked={shouldCreateContact}
            disabled={!capabilities.canCreateContacts || !capabilities.canViewContacts}
            onCheckedChange={setCreateContact}
          />
          {!shouldCreateContact && capabilities.canViewContacts ? (
            <Field className="mt-4">
              <FieldLabel htmlFor="lead-conversion-existing-contact">Existing contact</FieldLabel>
              <LinkedRecordPicker inputId="lead-conversion-existing-contact" recordType="contact" valueId={contactId} displayValue={contactSearch} onDisplayValueChange={(value) => { setContactSearch(value); setContactId(null); }} onSelect={(option) => { setContactId(option.id); setContactSearch(option.label); if (!shouldCreateAccount && !accountId && option.organization_id) { setAccountId(option.organization_id); setAccountSearch(option.organization_name || "Linked via contact"); } }} onClear={() => { setContactId(null); setContactSearch(""); }} placeholder="Search contacts" queryKeyPrefix="convert-lead-contact" noResultsText="No contacts matched this search." />
            </Field>
          ) : null}
        </FormSection>

        <FormSection title="Deal" description="Open a deal for this business, linked to the account and contact.">
          <ToggleRow
            label="Create deal"
            description={capabilities.canCreateOpportunities
              ? "Start a deal as part of this conversion."
              : "Deal creation is unavailable with your current permissions."}
            checked={shouldCreateDeal}
            disabled={!capabilities.canCreateOpportunities}
            onCheckedChange={setCreateDeal}
          />
          {shouldCreateDeal ? (
            <FieldGroup columns={2} className="mt-4">
              <Field><FieldLabel htmlFor="lead-conversion-opportunity-name">Deal name</FieldLabel><Input id="lead-conversion-opportunity-name" value={dealName} onChange={(event) => setDealName(event.target.value)} placeholder={defaultDealName} /></Field>
              <Field><FieldLabel htmlFor="lead-conversion-initial-stage">Initial stage</FieldLabel><OpportunityStageSelect id="lead-conversion-initial-stage" value={effectiveDealStage} onChange={setDealStage} filter={(semanticType) => semanticType !== "open"} /></Field>
              <Field data-invalid={Boolean(amountError)}>
                <FieldLabel htmlFor="lead-conversion-deal-amount">Amount</FieldLabel>
                <Input id="lead-conversion-deal-amount" inputMode="decimal" value={dealAmount} onChange={(event) => setDealAmount(event.target.value)} placeholder="0.00" aria-invalid={Boolean(amountError)} aria-describedby={amountError ? "lead-conversion-deal-amount-error" : undefined} />
                {amountError ? <FieldError id="lead-conversion-deal-amount-error">{amountError}</FieldError> : null}
              </Field>
              {currencies.length > 1 ? (
                <Field>
                  <FieldLabel htmlFor="lead-conversion-deal-currency">Currency</FieldLabel>
                  <Select value={effectiveDealCurrency} onValueChange={setDealCurrency}>
                    <SelectTrigger id="lead-conversion-deal-currency"><SelectValue /></SelectTrigger>
                    <SelectContent>{currencies.map((code) => <SelectItem key={code} value={code}>{code}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              ) : null}
              <Field>
                <FieldLabel htmlFor="lead-conversion-deal-close-date">Expected close date</FieldLabel>
                <Input id="lead-conversion-deal-close-date" type="date" value={dealCloseDate} onChange={(event) => setDealCloseDate(event.target.value)} />
              </Field>
            </FieldGroup>
          ) : null}
        </FormSection>
      </RecordFormLayout>
    </>
  );
}

function ToggleRow({ label, description, checked, disabled = false, onCheckedChange }: { label: string; description: string; checked: boolean; disabled?: boolean; onCheckedChange: (checked: boolean) => void }) {
  // H11: the switch's *on* could not be seen in the dark theme. The boolean is
  // `SegmentedBoolean` (design.md §7.1, rebuild ruling 4), whose state is written as words.
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-4 py-3">
      <div className="min-w-0"><div className="text-sm font-medium text-copy-primary">{label}</div><FieldDescription className="mt-1">{description}</FieldDescription></div>
      <SegmentedBoolean aria-label={label} value={checked} onValueChange={onCheckedChange} trueLabel="Yes" falseLabel="No" disabled={disabled} />
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <div className="border-b border-line-subtle pb-3 last:border-0 last:pb-0"><dt className="text-copy-muted">{label}</dt><dd className="mt-1 font-medium text-copy-primary">{value}</dd></div>;
}
