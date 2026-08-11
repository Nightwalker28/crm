"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, X } from "lucide-react";
import { toast } from "sonner";

import LinkedRecordPicker, { type LinkedRecordOption } from "@/components/crm/LinkedRecordPicker";
import { FormSection, RecordFormLayout } from "@/components/forms/RecordFormLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/PageHeader";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useClientPortalActions, type PricingItemPayload } from "@/hooks/useClientPortal";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";

type LinkedType = "contact" | "organization";

type PageForm = {
  title: string;
  summary: string;
  linkedType: LinkedType;
  linkedId: number | null;
  linkedLabel: string;
  itemName: string;
  itemDescription: string;
  itemQuantity: string;
  itemCurrency: string;
  itemPrice: string;
  brandCompanyName: string;
  brandLogoUrl: string;
  brandAccentColor: string;
  proposalOverview: string;
  proposalScope: string;
  proposalTerms: string;
};

type FormErrors = Partial<Record<"title" | "customer" | "itemName" | "quantity" | "currency" | "price" | "logoUrl" | "accentColor", string>>;

const EMPTY_FORM: PageForm = {
  title: "",
  summary: "",
  linkedType: "contact",
  linkedId: null,
  linkedLabel: "",
  itemName: "",
  itemDescription: "",
  itemQuantity: "1",
  itemCurrency: "USD",
  itemPrice: "",
  brandCompanyName: "",
  brandLogoUrl: "",
  brandAccentColor: "#14b8a6",
  proposalOverview: "",
  proposalScope: "",
  proposalTerms: "",
};

function proposalSections(form: PageForm) {
  return [
    { title: "Overview", body: form.proposalOverview.trim(), sort_order: 0 },
    { title: "Scope", body: form.proposalScope.trim(), sort_order: 1 },
    { title: "Terms", body: form.proposalTerms.trim(), sort_order: 2 },
  ].filter((section) => section.body);
}

function validOptionalUrl(value: string) {
  if (!value.trim()) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export default function ClientPageCreateForm() {
  const router = useRouter();
  const { createPage, isCreatingPage } = useClientPortalActions();
  const [form, setForm] = useState<PageForm>(EMPTY_FORM);
  const [documents, setDocuments] = useState<LinkedRecordOption[]>([]);
  const [documentSearch, setDocumentSearch] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [saveComplete, setSaveComplete] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const customerRef = useRef<HTMLDivElement>(null);
  const itemNameRef = useRef<HTMLInputElement>(null);
  const quantityRef = useRef<HTMLInputElement>(null);
  const currencyRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const logoUrlRef = useRef<HTMLInputElement>(null);
  const accentColorRef = useRef<HTMLInputElement>(null);

  const isDirty = JSON.stringify(form) !== JSON.stringify(EMPTY_FORM) || documents.length > 0;
  useUnsavedChangesGuard(isDirty, saveComplete);

  function update<K extends keyof PageForm>(key: K, value: PageForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function validate() {
    const next: FormErrors = {};
    const quantity = Number(form.itemQuantity);
    const price = Number(form.itemPrice);
    if (!form.title.trim()) next.title = "Page title is required.";
    if (!form.linkedId) next.customer = "Select one contact or account.";
    if (!form.itemName.trim()) next.itemName = "Pricing item name is required.";
    if (!Number.isFinite(quantity) || quantity <= 0) next.quantity = "Quantity must be greater than zero.";
    if (!/^[A-Za-z]{3}$/.test(form.itemCurrency.trim())) next.currency = "Use a three-letter currency code.";
    if (!Number.isFinite(price) || price < 0) next.price = "Public price must be zero or greater.";
    if (!validOptionalUrl(form.brandLogoUrl)) next.logoUrl = "Enter a valid HTTP or HTTPS logo URL.";
    if (form.brandAccentColor.trim() && !/^#[0-9a-fA-F]{6}$/.test(form.brandAccentColor.trim())) {
      next.accentColor = "Use a six-digit hex color such as #14b8a6.";
    }
    setErrors(next);

    const first = Object.keys(next)[0] as keyof FormErrors | undefined;
    const refs: Record<keyof FormErrors, React.RefObject<HTMLElement | null>> = {
      title: titleRef,
      customer: customerRef,
      itemName: itemNameRef,
      quantity: quantityRef,
      currency: currencyRef,
      price: priceRef,
      logoUrl: logoUrlRef,
      accentColor: accentColorRef,
    };
    if (first) refs[first].current?.focus();
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validate() || !form.linkedId) return;

    const item: PricingItemPayload = {
      name: form.itemName.trim(),
      description: form.itemDescription.trim() || null,
      quantity: Number(form.itemQuantity),
      currency: form.itemCurrency.trim().toUpperCase(),
      public_unit_price: Number(form.itemPrice),
    };
    try {
      const page = await createPage({
        title: form.title.trim(),
        summary: form.summary.trim() || null,
        contact_id: form.linkedType === "contact" ? form.linkedId : null,
        organization_id: form.linkedType === "organization" ? form.linkedId : null,
        pricing_items: [item],
        document_ids: documents.map((document) => document.id),
        proposal_sections: proposalSections(form),
        brand_settings: {
          company_name: form.brandCompanyName.trim() || null,
          logo_url: form.brandLogoUrl.trim() || null,
          accent_color: form.brandAccentColor.trim() || null,
        },
      });
      setSaveComplete(true);
      toast.success("Client page created.");
      router.push(`/dashboard/client-portal?createdPageId=${page.id}`);
    } catch {
      toast.error("We could not create this client page. Review the customer and attached documents, then try again.");
    }
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Create client page"
        description="Prepare a customer-specific pricing snapshot, proposal, and document package."
        actions={<Button variant="outline" asChild><Link href="/dashboard/client-portal"><ArrowLeft />Back to Client Portal</Link></Button>}
      />

      <form onSubmit={handleSubmit} noValidate>
        <RecordFormLayout
          sidebar={
            <>
              <Card className="p-5">
                <h2 className="text-sm font-semibold text-copy-primary">Sharing boundary</h2>
                <p className="mt-2 text-p-sm text-copy-secondary">
                  This draft is private to CRM users until you explicitly publish a scoped, expiring client link.
                </p>
              </Card>
              <Card className="p-5">
                <h2 className="text-sm font-semibold text-copy-primary">Package summary</h2>
                <dl className="mt-4 grid gap-3 text-sm">
                  <div className="flex justify-between gap-4"><dt className="text-copy-muted">Customer</dt><dd className="text-right text-copy-primary">{form.linkedLabel || "Not selected"}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-copy-muted">Pricing items</dt><dd className="text-copy-primary">1</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-copy-muted">Documents</dt><dd className="text-copy-primary">{documents.length}</dd></div>
                </dl>
              </Card>
            </>
          }
          footer={
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-copy-muted">{isDirty ? "Unsaved client page" : "Complete the required fields"}</span>
              <div className="flex gap-2">
                <Button type="button" variant="outline" asChild><Link href="/dashboard/client-portal">Cancel</Link></Button>
                <Button type="submit" disabled={isCreatingPage}><Plus />{isCreatingPage ? "Creating..." : "Create page"}</Button>
              </div>
            </div>
          }
        >
          <FormSection title="Page details" description="Choose exactly one customer for this private draft.">
            <FieldGroup>
              <Field data-invalid={Boolean(errors.title)}>
                <FieldLabel htmlFor="client-page-title">Page title <RequiredMark /></FieldLabel>
                <Input
                  ref={titleRef}
                  id="client-page-title"
                  value={form.title}
                  onChange={(event) => {
                    update("title", event.target.value);
                    setErrors((current) => ({ ...current, title: undefined }));
                  }}
                  maxLength={180}
                  aria-invalid={Boolean(errors.title)}
                  placeholder="Renewal proposal"
                />
                <FieldError>{errors.title}</FieldError>
              </Field>
              <Field data-invalid={Boolean(errors.customer)}>
                <FieldLabel htmlFor="client-page-customer">Customer <RequiredMark /></FieldLabel>
                <div className="grid gap-2 sm:grid-cols-[150px_1fr]">
                  <Select
                    value={form.linkedType}
                    onValueChange={(value) => {
                      update("linkedType", value as LinkedType);
                      update("linkedId", null);
                      update("linkedLabel", "");
                      setDocuments([]);
                    }}
                  >
                    <SelectTrigger aria-label="Customer type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="contact">Contact</SelectItem>
                      <SelectItem value="organization">Account</SelectItem>
                    </SelectContent>
                  </Select>
                  <div ref={customerRef} tabIndex={-1}>
                    <LinkedRecordPicker
                      inputId="client-page-customer"
                      recordType={form.linkedType}
                      valueId={form.linkedId}
                      displayValue={form.linkedLabel}
                      onDisplayValueChange={(value) => {
                        update("linkedLabel", value);
                        if (form.linkedId) update("linkedId", null);
                      }}
                      onSelect={(option) => {
                        update("linkedId", option.id);
                        update("linkedLabel", option.label);
                        setErrors((current) => ({ ...current, customer: undefined }));
                        setDocuments([]);
                      }}
                      onClear={() => {
                        update("linkedId", null);
                        update("linkedLabel", "");
                        setDocuments([]);
                      }}
                      placeholder={form.linkedType === "contact" ? "Search contacts" : "Search accounts"}
                      queryKeyPrefix="client-page-customer"
                    />
                  </div>
                </div>
                <FieldError>{errors.customer}</FieldError>
              </Field>
              <Field>
                <FieldLabel htmlFor="client-page-summary">Summary</FieldLabel>
                <Textarea id="client-page-summary" value={form.summary} onChange={(event) => update("summary", event.target.value)} rows={4} placeholder="Short proposal or pricing summary" />
              </Field>
            </FieldGroup>
          </FormSection>

          <FormSection title="Pricing snapshot" description="The published page stores this customer-facing price rather than recalculating it later.">
            <FieldGroup>
              <Field data-invalid={Boolean(errors.itemName)}>
                <FieldLabel htmlFor="client-page-item">Item <RequiredMark /></FieldLabel>
                <Input ref={itemNameRef} id="client-page-item" value={form.itemName} onChange={(event) => { update("itemName", event.target.value); setErrors((current) => ({ ...current, itemName: undefined })); }} maxLength={180} aria-invalid={Boolean(errors.itemName)} placeholder="Annual support plan" />
                <FieldError>{errors.itemName}</FieldError>
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field data-invalid={Boolean(errors.quantity)}>
                  <FieldLabel htmlFor="client-page-quantity">Quantity <RequiredMark /></FieldLabel>
                  <Input ref={quantityRef} id="client-page-quantity" value={form.itemQuantity} onChange={(event) => { update("itemQuantity", event.target.value); setErrors((current) => ({ ...current, quantity: undefined })); }} inputMode="decimal" aria-invalid={Boolean(errors.quantity)} />
                  <FieldError>{errors.quantity}</FieldError>
                </Field>
                <Field data-invalid={Boolean(errors.currency)}>
                  <FieldLabel htmlFor="client-page-currency">Currency <RequiredMark /></FieldLabel>
                  <Input ref={currencyRef} id="client-page-currency" value={form.itemCurrency} onChange={(event) => { update("itemCurrency", event.target.value); setErrors((current) => ({ ...current, currency: undefined })); }} maxLength={3} aria-invalid={Boolean(errors.currency)} />
                  <FieldError>{errors.currency}</FieldError>
                </Field>
                <Field data-invalid={Boolean(errors.price)}>
                  <FieldLabel htmlFor="client-page-price">Public unit price <RequiredMark /></FieldLabel>
                  <Input ref={priceRef} id="client-page-price" value={form.itemPrice} onChange={(event) => { update("itemPrice", event.target.value); setErrors((current) => ({ ...current, price: undefined })); }} inputMode="decimal" aria-invalid={Boolean(errors.price)} placeholder="0.00" />
                  <FieldError>{errors.price}</FieldError>
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="client-page-item-description">Item description</FieldLabel>
                <Textarea id="client-page-item-description" value={form.itemDescription} onChange={(event) => update("itemDescription", event.target.value)} rows={3} />
              </Field>
            </FieldGroup>
          </FormSection>

          <FormSection title="Documents" description="Only attach documents that are already linked to the selected customer.">
            <Field>
              <FieldLabel htmlFor="client-page-document">Search documents</FieldLabel>
              <LinkedRecordPicker
                inputId="client-page-document"
                recordType="document"
                valueId={null}
                displayValue={documentSearch}
                onDisplayValueChange={setDocumentSearch}
                onSelect={(option) => {
                  if (!documents.some((document) => document.id === option.id)) setDocuments((current) => [...current, option]);
                  setDocumentSearch("");
                }}
                onClear={() => setDocumentSearch("")}
                placeholder={form.linkedId ? "Search customer documents" : "Select a customer first"}
                disabled={!form.linkedId}
                queryKeyPrefix="client-page-document"
                linkedModuleKey={form.linkedId ? (form.linkedType === "contact" ? "sales_contacts" : "sales_organizations") : undefined}
                linkedEntityId={form.linkedId}
              />
              {documents.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {documents.map((document) => (
                    <span key={document.id} className="inline-flex items-center gap-2 rounded-full border border-line-default bg-surface-muted px-3 py-1 text-xs text-copy-secondary">
                      {document.label}
                      <Button type="button" variant="ghost" size="icon-sm" className="-mr-2 size-6 rounded-full" onClick={() => setDocuments((current) => current.filter((item) => item.id !== document.id))} aria-label={`Remove ${document.label}`}><X className="h-3 w-3" /></Button>
                    </span>
                  ))}
                </div>
              ) : null}
            </Field>
          </FormSection>

          <FormSection title="Proposal" description="Optional sections appear in this order on the published page.">
            <FieldGroup>
              <Field><FieldLabel htmlFor="client-page-overview">Overview</FieldLabel><Textarea id="client-page-overview" value={form.proposalOverview} onChange={(event) => update("proposalOverview", event.target.value)} maxLength={4000} rows={5} /></Field>
              <Field><FieldLabel htmlFor="client-page-scope">Scope and deliverables</FieldLabel><Textarea id="client-page-scope" value={form.proposalScope} onChange={(event) => update("proposalScope", event.target.value)} maxLength={4000} rows={5} /></Field>
              <Field><FieldLabel htmlFor="client-page-terms">Terms and next steps</FieldLabel><Textarea id="client-page-terms" value={form.proposalTerms} onChange={(event) => update("proposalTerms", event.target.value)} maxLength={4000} rows={5} /></Field>
            </FieldGroup>
          </FormSection>

          <FormSection title="Branding" description="Optional presentation settings for this client page.">
            <FieldGroup>
              <Field><FieldLabel htmlFor="client-page-company">Company name</FieldLabel><Input id="client-page-company" value={form.brandCompanyName} onChange={(event) => update("brandCompanyName", event.target.value)} maxLength={150} /></Field>
              <Field data-invalid={Boolean(errors.logoUrl)}>
                <FieldLabel htmlFor="client-page-logo">Logo URL</FieldLabel>
                <Input ref={logoUrlRef} id="client-page-logo" type="url" value={form.brandLogoUrl} onChange={(event) => { update("brandLogoUrl", event.target.value); setErrors((current) => ({ ...current, logoUrl: undefined })); }} maxLength={500} aria-invalid={Boolean(errors.logoUrl)} placeholder="https://example.com/logo.png" />
                <FieldError>{errors.logoUrl}</FieldError>
              </Field>
              <Field data-invalid={Boolean(errors.accentColor)}>
                <FieldLabel htmlFor="client-page-accent">Accent color</FieldLabel>
                <Input ref={accentColorRef} id="client-page-accent" value={form.brandAccentColor} onChange={(event) => { update("brandAccentColor", event.target.value); setErrors((current) => ({ ...current, accentColor: undefined })); }} maxLength={20} aria-invalid={Boolean(errors.accentColor)} />
                <FieldDescription>Use a six-digit hex color.</FieldDescription>
                <FieldError>{errors.accentColor}</FieldError>
              </Field>
            </FieldGroup>
          </FormSection>
        </RecordFormLayout>
      </form>
    </div>
  );
}
