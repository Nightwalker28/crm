"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Play, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import { FormErrorBanner } from "@/components/forms/FormErrorBanner";
import { FormSection, RecordFormLayout } from "@/components/forms/RecordFormLayout";
import {
  areTransactionItemsValid,
  calculateTransactionTotals,
  createTransactionLineItem,
  parseTransactionDiscount,
  transactionCatalogLink,
  transactionLineFields,
  transactionTaxFields,
  TransactionLineItemsEditor,
  useTransactionTax,
  type TransactionLineItem,
} from "@/components/transactions/TransactionLineItemsEditor";
import { TransactionTotals } from "@/components/transactions/TransactionTotals";
import { Button } from "@/components/ui/button";
import { Fact, FactList } from "@/components/ui/Fact";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/Money";
import { PageShell } from "@/components/ui/PageShell";
import { PermissionDeniedState } from "@/components/ui/PermissionDeniedState";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { RouteErrorState, RouteLoadingState } from "@/components/ui/RouteStates";
import { SegmentedBoolean, SegmentedControl, SegmentedItem } from "@/components/ui/SegmentedControl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusValue } from "@/components/ui/StatusValue";
import { Textarea } from "@/components/ui/textarea";
import { TextLink } from "@/components/ui/TextLink";
import { useDefaultTaxMode, type TaxMode } from "@/hooks/finance/useTaxRates";
import {
  jsonBody,
  receivablesRequest,
  useRecurringDraftFromInvoice,
  useRecurringInvoice,
  type RecurringAction,
  type RecurringDraft,
  type RecurringFrequency,
  type RecurringInvoice,
  type RecurringLine,
} from "@/hooks/finance/useReceivables";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useBaseCurrency, useCompanyCurrencies } from "@/hooks/useCompanyCurrencies";
import { useConfirm } from "@/hooks/useConfirm";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { formatDateOnly, formatDateTime, todayIsoDate } from "@/lib/datetime";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { getPosInvoiceStatus, getRecurringInvoiceStatus } from "@/lib/statusStyles";

const FREQUENCIES: Array<{ value: RecurringFrequency; label: string; unit: string }> = [
  { value: "weekly", label: "Weekly", unit: "weeks" },
  { value: "monthly", label: "Monthly", unit: "months" },
  { value: "quarterly", label: "Quarterly", unit: "quarters" },
  { value: "yearly", label: "Yearly", unit: "years" },
];

type Ends = "never" | "on_date" | "after_count";

type Form = {
  name: string;
  customer_name: string;
  customer_email: string;
  customer_organization_id: number | null;
  customer_organization_name: string;
  customer_contact_id: number | null;
  customer_contact_name: string;
  currency: string;
  tax_mode: string;
  payment_terms: string;
  notes: string;
  frequency: RecurringFrequency;
  interval_count: string;
  start_date: string;
  ends: Ends;
  end_date: string;
  max_count: string;
  action: RecurringAction;
  active: boolean;
};

function linesToItems(lines: RecurringLine[] | undefined): TransactionLineItem[] {
  if (!lines?.length) return [createTransactionLineItem("recurring")];
  return lines.map((line) => ({
    ...createTransactionLineItem("recurring"),
    ...transactionCatalogLink(line),
    name: line.description,
    description: "",
    quantity: String(line.quantity ?? 1),
    unit_price: String(line.unit_price ?? 0),
    discount_amount: String(line.discount_amount ?? 0),
    ...transactionTaxFields(line),
    ...transactionLineFields(line),
  }));
}

function itemsToLines(items: TransactionLineItem[]): RecurringLine[] {
  return items.map((line) => {
    const discount = parseTransactionDiscount(line.discount_amount);
    const isItem = line.line_type === "item";
    return {
      ...transactionCatalogLink(line),
      description: line.name.trim(),
      line_type: line.line_type,
      quantity: isItem ? line.quantity : "1",
      unit_price: isItem ? line.unit_price : "0",
      discount_amount: discount.amount,
      discount_percent: discount.percent,
      unit: line.unit.trim() || null,
      tax_rate_id: line.tax_rate_id,
      tax_manual: line.tax_manual,
      tax_amount: line.tax_manual ? line.tax_amount : "0",
    };
  });
}

function formFrom(source: RecurringDraft | undefined): Form {
  return {
    name: source?.name ?? "",
    customer_name: source?.customer_name ?? "",
    customer_email: source?.customer_email ?? "",
    customer_organization_id: source?.customer_organization_id ?? null,
    customer_organization_name: source?.customer_organization_name ?? "",
    customer_contact_id: source?.customer_contact_id ?? null,
    customer_contact_name: source?.customer_contact_name ?? "",
    currency: source?.currency ?? "",
    tax_mode: source?.tax_mode ?? "",
    payment_terms: source?.payment_terms ?? "",
    notes: source?.notes ?? "",
    frequency: source?.frequency ?? "monthly",
    interval_count: String(source?.interval_count ?? 1),
    start_date: source?.start_date ?? todayIsoDate(),
    ends: source?.end_date ? "on_date" : source?.max_count ? "after_count" : "never",
    end_date: source?.end_date ?? "",
    max_count: source?.max_count ? String(source.max_count) : "",
    action: source?.action ?? "draft",
    active: source?.active ?? true,
  };
}

/**
 * A recurring invoice (13d §3.6, decision 10): the invoice to make and its schedule. One page
 * for *new* and for an existing profile, whose rail adds what it has done so far.
 */
export default function RecurringInvoiceFormPage({ profileId }: { profileId?: number }) {
  const fromInvoice = Number(useSearchParams().get("from_invoice")) || null;
  const { modules, isLoading: modulesLoading } = useAccessibleModules();
  const actions = modules.find((module) => module.name === "finance_recurring_invoices")?.actions;
  const profile = useRecurringInvoice(profileId ?? null);
  const draft = useRecurringDraftFromInvoice(profileId ? null : fromInvoice);
  if (modulesLoading || profile.isLoading || draft.isLoading) return <RouteLoadingState label="recurring invoice" />;
  if (profileId ? !actions?.can_view : !actions?.can_create) return <PermissionDeniedState />;
  if (profile.error || draft.error) {
    return (
      <RouteErrorState
        title={profile.error ? "This recurring invoice could not be loaded" : "The invoice could not be copied"}
        reset={() => void (profile.error ? profile.refetch() : draft.refetch())}
        backHref={DASHBOARD_ROUTES.recurringInvoices}
        backLabel="Back to recurring invoices"
      />
    );
  }
  const source = profile.data ?? draft.data;
  return (
    <RecurringInvoiceEditor
      key={`${profileId ?? "new"}:${profile.data?.updated_at ?? ""}:${fromInvoice ?? ""}`}
      profile={profile.data}
      source={source}
      canEdit={profileId ? Boolean(actions?.can_edit) : true}
      canDelete={Boolean(actions?.can_delete)}
      canIssue={Boolean(modules.find((module) => module.name === "finance_pos")?.actions?.can_edit)}
    />
  );
}

function RecurringInvoiceEditor({
  profile,
  source,
  canEdit,
  canDelete,
  canIssue,
}: {
  profile?: RecurringInvoice;
  source?: RecurringDraft;
  canEdit: boolean;
  canDelete: boolean;
  canIssue: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const currencies = useCompanyCurrencies();
  const baseCurrency = useBaseCurrency();
  const defaultTaxMode = useDefaultTaxMode();
  const [form, setForm] = useState<Form>(() => formFrom(source));
  const [items, setItems] = useState<TransactionLineItem[]>(() => linesToItems(source?.lines));
  const [initial] = useState(() => JSON.stringify([formFrom(source), itemsToLines(linesToItems(source?.lines))]));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "run" | "delete" | null>(null);
  const currency = form.currency || baseCurrency.data || "USD";
  const taxMode: TaxMode = form.tax_mode === "inclusive" || form.tax_mode === "exclusive" ? form.tax_mode : (defaultTaxMode.data ?? "exclusive");
  const tax = useTransactionTax(taxMode);
  const totals = useMemo(() => calculateTransactionTotals(items, tax), [items, tax]);
  const dirty = JSON.stringify([form, itemsToLines(items)]) !== initial;
  useUnsavedChangesGuard(dirty, busy === "save");
  const set = (patch: Partial<Form>) => setForm((current) => ({ ...current, ...patch }));
  const frequency = FREQUENCIES.find((option) => option.value === form.frequency) ?? FREQUENCIES[1];
  const readOnly = !canEdit;

  function validate() {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = "Name this recurring invoice.";
    if (!form.customer_name.trim() && !form.customer_organization_id) next.customer_name = "Choose the customer.";
    const interval = Number(form.interval_count);
    if (!Number.isInteger(interval) || interval < 1 || interval > 52) next.interval_count = "Enter a whole number from 1 to 52.";
    if (!form.start_date) next.start_date = "Choose the first invoice date.";
    if (form.ends === "on_date" && (!form.end_date || form.end_date < form.start_date)) next.end_date = "The end date cannot be before the start date.";
    if (form.ends === "after_count" && !(Number(form.max_count) >= 1)) next.max_count = "Make at least one invoice.";
    if (form.action === "issue_and_send" && !form.customer_email.trim() && !form.customer_contact_id && !form.customer_organization_id) {
      next.customer_email = "Issued invoices are emailed: add the customer's email address.";
    }
    const linesOk = areTransactionItemsValid(items);
    if (!linesOk) next.lines = "Each line needs a description, a positive quantity and a price that is not negative.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function save() {
    if (!validate()) return;
    setBusy("save");
    setSubmitError(null);
    try {
      const body = {
        name: form.name.trim(),
        customer_name: form.customer_name.trim() || null,
        customer_email: form.customer_email.trim() || null,
        customer_organization_id: form.customer_organization_id,
        customer_contact_id: form.customer_contact_id,
        currency,
        tax_mode: taxMode,
        payment_terms: form.payment_terms.trim() || null,
        notes: form.notes.trim() || null,
        frequency: form.frequency,
        interval_count: Number(form.interval_count),
        start_date: form.start_date,
        end_date: form.ends === "on_date" ? form.end_date : null,
        max_count: form.ends === "after_count" ? Number(form.max_count) : null,
        action: form.action,
        active: form.active,
        lines: itemsToLines(items),
      };
      const saved = await receivablesRequest<RecurringInvoice>(
        profile ? `/finance/recurring-invoices/${profile.id}` : "/finance/recurring-invoices",
        jsonBody(profile ? "PATCH" : "POST", body),
        "The recurring invoice could not be saved.",
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["document-list", "finance_recurring_invoices"] }),
        queryClient.invalidateQueries({ queryKey: ["recurring-invoice", saved.id] }),
      ]);
      toast.success(profile ? "Recurring invoice saved." : `Recurring invoice created. The first invoice is made on ${formatDateOnly(saved.next_run_date)}.`);
      if (!profile) router.push(`${DASHBOARD_ROUTES.recurringInvoices}/${saved.id}`);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "The recurring invoice could not be saved.");
    } finally {
      setBusy(null);
    }
  }

  async function runNow() {
    if (!profile) return;
    const ok = await confirm({
      title: "Make the next invoice now?",
      description: profile.action === "issue_and_send"
        ? `The ${formatDateOnly(profile.next_run_date)} invoice is issued and emailed to the customer now, and the schedule moves on to the following date.`
        : `The ${formatDateOnly(profile.next_run_date)} invoice is saved as a draft now, and the schedule moves on to the following date.`,
      confirmLabel: "Make invoice",
    });
    if (!ok) return;
    setBusy("run");
    try {
      const result = await receivablesRequest<{ invoice_id: number; invoice_number: string | null }>(
        `/finance/recurring-invoices/${profile.id}/run`, { method: "POST" }, "The invoice could not be made.");
      await queryClient.invalidateQueries({ queryKey: ["recurring-invoice", profile.id] });
      toast.success(result.invoice_number ? `Invoice ${result.invoice_number} made.` : "Draft invoice made.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The invoice could not be made.");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!profile) return;
    const ok = await confirm({
      title: "Delete this recurring invoice?",
      description: "No more invoices are made from it. Invoices it already made are kept. You can restore it from the recycle bin; it comes back paused.",
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    setBusy("delete");
    try {
      await receivablesRequest(`/finance/recurring-invoices/${profile.id}`, { method: "DELETE" }, "The recurring invoice could not be deleted.");
      await queryClient.invalidateQueries({ queryKey: ["document-list", "finance_recurring_invoices"] });
      toast.success("Recurring invoice deleted.");
      router.push(DASHBOARD_ROUTES.recurringInvoices);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The recurring invoice could not be deleted.");
      setBusy(null);
    }
  }

  const title = profile?.name || (source?.source_invoice_number ? `Repeat ${source.source_invoice_number}` : "New recurring invoice");

  return (
    <PageShell
      eyebrow={profile?.updated_at ? `Last modified ${formatDateTime(profile.updated_at)}` : undefined}
      title={title}
      description="The invoice to make, and when. Each one is an ordinary invoice with its own number, made on the schedule."
      actions={(
        <Button asChild variant="ghost" size="sm">
          <Link href={DASHBOARD_ROUTES.recurringInvoices}><ArrowLeft />Back to recurring invoices</Link>
        </Button>
      )}
    >
      {submitError ? <FormErrorBanner title="We could not save this recurring invoice.">{submitError}</FormErrorBanner> : null}
      <RecordFormLayout
        title={title}
        status={dirty ? "Unsaved changes" : profile ? null : "Nothing is made until the first invoice date."}
        actions={(
          <>
            {profile && canDelete ? (
              <Button variant="destructiveGhost" onClick={() => void remove()} disabled={busy !== null}>
                <Trash2 />
                Delete
              </Button>
            ) : null}
            <Button asChild variant="outline"><Link href={DASHBOARD_ROUTES.recurringInvoices}>Cancel</Link></Button>
            {canEdit ? (
              <Button onClick={() => void save()} disabled={busy !== null}>
                <Save />
                {busy === "save" ? "Saving…" : profile ? "Save changes" : "Create recurring invoice"}
              </Button>
            ) : null}
          </>
        )}
        sidebar={(
          <>
            {profile ? (
              <FormSection title="Progress" action={<StatusValue status={getRecurringInvoiceStatus(profile.status)} />}>
                <FactList>
                  <Fact label="Next invoice">{profile.next_run_date ? formatDateOnly(profile.next_run_date) : "None scheduled"}</Fact>
                  <Fact label="Invoices made">{profile.issued_count}{profile.max_count ? ` of ${profile.max_count}` : ""}</Fact>
                  {profile.last_run_at ? <Fact label="Last run">{formatDateTime(profile.last_run_at)}</Fact> : null}
                </FactList>
                {profile.last_error ? <p role="alert" className="mt-3 text-sm text-state-danger">{profile.last_error}</p> : null}
                {profile.lines_error ? <p role="alert" className="mt-3 text-sm text-state-danger">{profile.lines_error}</p> : null}
                {canEdit && profile.active && profile.next_run_date ? (
                  <Button className="mt-4 w-full" variant="outline" onClick={() => void runNow()} disabled={busy !== null || dirty}>
                    <Play />
                    {busy === "run" ? "Making…" : "Make the next invoice now"}
                  </Button>
                ) : null}
              </FormSection>
            ) : null}
            <FormSection title="Schedule">
              <div className="grid gap-4">
                <Field>
                  <FieldLabel htmlFor="recurring-frequency">Repeats</FieldLabel>
                  <Select value={form.frequency} onValueChange={(value) => set({ frequency: value as RecurringFrequency })} disabled={readOnly}>
                    <SelectTrigger id="recurring-frequency" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{FREQUENCIES.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field data-invalid={Boolean(errors.interval_count)}>
                  <FieldLabel htmlFor="recurring-interval">Every</FieldLabel>
                  <div className="flex items-center gap-2">
                    <Input id="recurring-interval" type="number" inputMode="numeric" min={1} max={52} className="max-w-24" value={form.interval_count}
                      onChange={(event) => set({ interval_count: event.target.value })} disabled={readOnly} aria-invalid={Boolean(errors.interval_count)} />
                    <span className="text-sm text-copy-secondary">{frequency.unit}</span>
                  </div>
                  {errors.interval_count ? <FieldError>{errors.interval_count}</FieldError> : null}
                </Field>
                <Field data-invalid={Boolean(errors.start_date)}>
                  <FieldLabel htmlFor="recurring-start">First invoice date<RequiredMark /></FieldLabel>
                  <Input id="recurring-start" type="date" value={form.start_date} onChange={(event) => set({ start_date: event.target.value })}
                    disabled={readOnly} aria-invalid={Boolean(errors.start_date)} />
                  <FieldDescription>Later invoices keep this day of the month, or the month&apos;s last day when it is shorter.</FieldDescription>
                  {errors.start_date ? <FieldError>{errors.start_date}</FieldError> : null}
                </Field>
                <Field>
                  <FieldLabel htmlFor="recurring-ends">Ends</FieldLabel>
                  <Select value={form.ends} onValueChange={(value) => set({ ends: value as Ends })} disabled={readOnly}>
                    <SelectTrigger id="recurring-ends" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="never">Never</SelectItem>
                      <SelectItem value="on_date">On a date</SelectItem>
                      <SelectItem value="after_count">After a number of invoices</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {form.ends === "on_date" ? (
                  <Field data-invalid={Boolean(errors.end_date)}>
                    <FieldLabel htmlFor="recurring-end-date">Last possible date</FieldLabel>
                    <Input id="recurring-end-date" type="date" value={form.end_date} onChange={(event) => set({ end_date: event.target.value })}
                      disabled={readOnly} aria-invalid={Boolean(errors.end_date)} />
                    {errors.end_date ? <FieldError>{errors.end_date}</FieldError> : null}
                  </Field>
                ) : null}
                {form.ends === "after_count" ? (
                  <Field data-invalid={Boolean(errors.max_count)}>
                    <FieldLabel htmlFor="recurring-max-count">Number of invoices</FieldLabel>
                    <Input id="recurring-max-count" type="number" inputMode="numeric" min={1} className="max-w-24" value={form.max_count}
                      onChange={(event) => set({ max_count: event.target.value })} disabled={readOnly} aria-invalid={Boolean(errors.max_count)} />
                    {errors.max_count ? <FieldError>{errors.max_count}</FieldError> : null}
                  </Field>
                ) : null}
                <Field>
                  <FieldLabel>Each invoice is</FieldLabel>
                  <SegmentedControl value={form.action} onValueChange={(value) => set({ action: value as RecurringAction })} aria-label="Each invoice is">
                    <SegmentedItem value="draft" disabled={readOnly}>Saved as a draft</SegmentedItem>
                    <SegmentedItem value="issue_and_send" disabled={readOnly || !canIssue}>Issued and emailed</SegmentedItem>
                  </SegmentedControl>
                  <FieldDescription>
                    {form.action === "draft"
                      ? "Someone reviews and issues each one."
                      : "Issued with its number and emailed with its PDF from the workspace sender (Settings → Integrations)."}
                  </FieldDescription>
                </Field>
                {profile ? (
                  <Field>
                    <FieldLabel>Running</FieldLabel>
                    <SegmentedBoolean value={form.active} onValueChange={(active) => set({ active })} trueLabel="On" falseLabel="Paused"
                      disabled={readOnly} aria-label="Running" />
                  </Field>
                ) : null}
              </div>
            </FormSection>
            <TransactionTotals
              description="Each invoice's totals are worked out again when it is made, with the rates in force then."
              currency={currency}
              rows={[
                { label: "Subtotal", amount: totals.subtotal },
                { label: "Discount", amount: totals.discount, negative: true },
                { label: "Tax", amount: totals.tax },
                { label: "Each invoice", amount: totals.total, resolved: true },
              ]}
            />
          </>
        )}
      >
        <FormSection title="Details">
          <div className="grid gap-4 md:grid-cols-2">
            <Field data-invalid={Boolean(errors.name)} className="md:col-span-2">
              <FieldLabel htmlFor="recurring-name">Name<RequiredMark /></FieldLabel>
              <Input id="recurring-name" value={form.name} onChange={(event) => set({ name: event.target.value })} maxLength={200}
                placeholder="Acme — monthly support" disabled={readOnly} aria-invalid={Boolean(errors.name)} />
              {errors.name ? <FieldError>{errors.name}</FieldError> : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="recurring-account">Account</FieldLabel>
              <LinkedRecordPicker
                inputId="recurring-account"
                recordType="organization"
                valueId={form.customer_organization_id}
                displayValue={form.customer_organization_name}
                disabled={readOnly}
                onDisplayValueChange={(customer_organization_name) => set({ customer_organization_id: null, customer_organization_name, customer_contact_id: null, customer_contact_name: "" })}
                onSelect={(option) => set({ customer_organization_id: option.id, customer_organization_name: option.label,
                  customer_name: form.customer_name.trim() || option.label, customer_contact_id: null, customer_contact_name: "" })}
                onClear={() => set({ customer_organization_id: null, customer_organization_name: "", customer_contact_id: null, customer_contact_name: "" })}
                placeholder="Search accounts"
                queryKeyPrefix="recurring-account"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="recurring-contact">Contact</FieldLabel>
              <LinkedRecordPicker
                inputId="recurring-contact"
                recordType="contact"
                valueId={form.customer_contact_id}
                displayValue={form.customer_contact_name}
                disabled={readOnly}
                onDisplayValueChange={(customer_contact_name) => set({ customer_contact_id: null, customer_contact_name })}
                onSelect={(option) => {
                  const raw = option.raw as { primary_email?: string | null } | undefined;
                  set({
                    customer_contact_id: option.id, customer_contact_name: option.label,
                    customer_organization_id: option.organization_id ?? form.customer_organization_id,
                    customer_organization_name: option.organization_name ?? form.customer_organization_name,
                    customer_name: form.customer_name.trim() || option.organization_name || option.label,
                    customer_email: form.customer_email.trim() || raw?.primary_email || "",
                  });
                }}
                onClear={() => set({ customer_contact_id: null, customer_contact_name: "" })}
                placeholder="Search contacts"
                queryKeyPrefix="recurring-contact"
                filters={{ organizationId: form.customer_organization_id }}
              />
            </Field>
            <Field data-invalid={Boolean(errors.customer_name)}>
              <FieldLabel htmlFor="recurring-customer">Bill to<RequiredMark /></FieldLabel>
              <Input id="recurring-customer" value={form.customer_name} onChange={(event) => set({ customer_name: event.target.value })}
                disabled={readOnly} aria-invalid={Boolean(errors.customer_name)} />
              {errors.customer_name ? <FieldError>{errors.customer_name}</FieldError> : null}
            </Field>
            <Field data-invalid={Boolean(errors.customer_email)}>
              <FieldLabel htmlFor="recurring-email">Email invoices to</FieldLabel>
              <Input id="recurring-email" type="email" value={form.customer_email} onChange={(event) => set({ customer_email: event.target.value })}
                placeholder="The contact's or account's address when empty" disabled={readOnly} aria-invalid={Boolean(errors.customer_email)} />
              {errors.customer_email ? <FieldError>{errors.customer_email}</FieldError> : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="recurring-currency">Currency</FieldLabel>
              <Select value={currency} onValueChange={(value) => set({ currency: value })} disabled={readOnly}>
                <SelectTrigger id="recurring-currency" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(currencies.data ?? [currency]).map((code) => <SelectItem key={code} value={code}>{code}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="recurring-terms">Payment terms</FieldLabel>
              <Input id="recurring-terms" value={form.payment_terms} onChange={(event) => set({ payment_terms: event.target.value })}
                placeholder="The account's terms set the due date" disabled={readOnly} />
            </Field>
          </div>
        </FormSection>
        <FormSection title="Lines" description="What every invoice bills.">
          <TransactionLineItemsEditor
            items={items}
            onChange={(next) => { setItems(next); setErrors((current) => ({ ...current, lines: "" })); }}
            currency={currency}
            error={errors.lines || null}
            idPrefix="recurring"
            itemLabel="Description"
            showDescription={false}
            taxMode={taxMode}
            onTaxModeChange={(next) => set({ tax_mode: next })}
          />
        </FormSection>
        <FormSection title="Notes">
          <Textarea id="recurring-notes" aria-label="Notes printed on each invoice" value={form.notes} rows={3}
            onChange={(event) => set({ notes: event.target.value })} disabled={readOnly} />
        </FormSection>
        {profile?.invoices?.length ? (
          <FormSection title="Invoices made" description="The most recent fifty.">
            <ul className="divide-y divide-line-subtle">
              {profile.invoices.map((invoice) => (
                <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                  <span className="flex items-center gap-3">
                    <TextLink href={`${DASHBOARD_ROUTES.invoices}/${invoice.id}`}>{invoice.invoice_number ?? "Draft invoice"}</TextLink>
                    <span className="text-copy-muted">{invoice.issue_date ? formatDateOnly(invoice.issue_date) : ""}</span>
                    <StatusValue status={getPosInvoiceStatus(invoice.status)} />
                  </span>
                  <Money amount={invoice.total_amount} currency={invoice.currency} className="text-copy-primary" />
                </li>
              ))}
            </ul>
          </FormSection>
        ) : null}
      </RecordFormLayout>
    </PageShell>
  );
}
