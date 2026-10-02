"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";

import { FormFooter } from "@/components/ui/ActionBar";
import { FormSection } from "@/components/forms/RecordFormLayout";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { ImageAssetField, validateImageAssetFile } from "@/components/ui/ImageAssetField";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/hooks/useConfirm";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { ApiError, apiFetch, isForbiddenError } from "@/lib/api";

type CompanyResponse = {
  id: number;
  name: string;
  primary_email?: string | null;
  website?: string | null;
  primary_phone?: string | null;
  industry?: string | null;
  country?: string | null;
  operating_currencies?: string[] | null;
  billing_address?: string | null;
  logo_url?: string | null;
  invoicing_policy?: "delivered" | "ordered";
  default_payment_terms_days?: number | null;
};

type CompanyForm = {
  name: string;
  primary_email: string;
  website: string;
  primary_phone: string;
  industry: string;
  country: string;
  operating_currencies: string;
  billing_address: string;
  invoicing_policy: "delivered" | "ordered";
  default_payment_terms_days: string;
};

const emptyForm: CompanyForm = {
  name: "",
  primary_email: "",
  website: "",
  primary_phone: "",
  industry: "",
  country: "",
  operating_currencies: "USD",
  billing_address: "",
  invoicing_policy: "delivered",
  default_payment_terms_days: "",
};

function companyToForm(data: CompanyResponse): CompanyForm {
  return {
    name: data.name ?? "",
    primary_email: data.primary_email ?? "",
    website: data.website ?? "",
    primary_phone: data.primary_phone ?? "",
    industry: data.industry ?? "",
    country: data.country ?? "",
    operating_currencies:
      Array.isArray(data.operating_currencies) && data.operating_currencies.length
        ? data.operating_currencies.join(", ")
        : "USD",
    billing_address: data.billing_address ?? "",
    invoicing_policy: data.invoicing_policy === "ordered" ? "ordered" : "delivered",
    default_payment_terms_days: data.default_payment_terms_days != null ? String(data.default_payment_terms_days) : "",
  };
}

function companyPayload(form: CompanyForm) {
  return {
    name: form.name.trim(),
    primary_email: form.primary_email.trim() || null,
    website: form.website.trim() || null,
    primary_phone: form.primary_phone.trim() || null,
    industry: form.industry.trim() || null,
    country: form.country.trim() || null,
    operating_currencies: Array.from(
      new Set(
        form.operating_currencies
          .split(",")
          .map((value) => value.trim().toUpperCase())
          .filter(Boolean),
      ),
    ),
    billing_address: form.billing_address.trim() || null,
    invoicing_policy: form.invoicing_policy,
    default_payment_terms_days: form.default_payment_terms_days.trim() === ""
      ? null
      : Math.max(0, Math.min(365, Math.round(Number(form.default_payment_terms_days)) || 0)),
  };
}

async function readJson(response: Response) {
  return response.json().catch(() => null);
}

export default function CompanyPage() {
  const { confirm } = useConfirm();
  const [form, setForm] = useState<CompanyForm>(emptyForm);
  const [initialForm, setInitialForm] = useState<CompanyForm>(emptyForm);
  const [logoUrl, setLogoUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoBusyAction, setLogoBusyAction] = useState<"uploading" | "removing" | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initialForm), [form, initialForm]);

  const loadCompany = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      setLoadError(null);
      const response = await apiFetch("/users/company", { signal });
      const body = await readJson(response);
      if (!response.ok) throw new ApiError(response.status, "Company profile could not be loaded.");

      const nextForm = companyToForm(body as CompanyResponse);
      setForm(nextForm);
      setInitialForm(nextForm);
      setLogoUrl((body as CompanyResponse).logo_url ?? "");
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
      setLoadError(error);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadCompany(controller.signal);
    return () => controller.abort();
  }, [loadCompany]);

  useUnsavedChangesGuard(isDirty, saving);

  async function handleSave() {
    try {
      setSaving(true);
      setActionError(null);
      const response = await apiFetch("/users/company", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(companyPayload(form)),
      });
      const body = await readJson(response);
      if (!response.ok) throw new Error("Company profile could not be saved.");

      const savedForm = companyToForm(body as CompanyResponse);
      setForm(savedForm);
      setInitialForm(savedForm);
      toast.success("Company profile updated.");
    } catch {
      setActionError("Company profile could not be saved. Review the fields and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDiscard() {
    const confirmed = await confirm({
      title: "Discard company profile changes?",
      description: "The company profile will return to the last saved values. An already uploaded logo remains saved.",
      confirmLabel: "Discard changes",
      variant: "destructive",
    });
    if (!confirmed) return;
    setForm(initialForm);
    setActionError(null);
  }

  async function handleLogoUpload(file: File) {
    const validationError = validateImageAssetFile(file);
    if (validationError) {
      setLogoError(validationError);
      return;
    }

    try {
      setLogoBusyAction("uploading");
      setLogoError(null);
      const formData = new FormData();
      formData.append("file", file);

      const response = await apiFetch("/users/company/logo", {
        method: "POST",
        body: formData,
      });
      const body = await readJson(response);
      if (!response.ok) throw new Error("Company logo could not be uploaded.");

      const logoUrl = typeof body?.logo_url === "string" ? body.logo_url : "";
      setLogoUrl(logoUrl);
      toast.success("Company logo uploaded.");
    } catch {
      setLogoError("Company logo could not be uploaded. Choose a JPG, PNG, or WebP image up to 5 MB.");
    } finally {
      setLogoBusyAction(null);
    }
  }

  async function handleLogoRemove() {
    const confirmed = await confirm({
      title: "Remove company logo?",
      description: "The workspace will use its default company branding until another logo is uploaded.",
      confirmLabel: "Remove image",
      variant: "destructive",
    });
    if (!confirmed) return;

    try {
      setLogoBusyAction("removing");
      setLogoError(null);
      const response = await apiFetch("/users/company/logo", { method: "DELETE" });
      if (!response.ok) throw new Error("Company logo could not be removed.");
      setLogoUrl("");
      toast.success("Company logo removed.");
    } catch {
      setLogoError("Company logo could not be removed. Try again.");
    } finally {
      setLogoBusyAction(null);
    }
  }

  return (
    <PageShell
      variant="settings"
      title="General"
      description="Company profile and tenant setup."
      isLoading={loading && !loadError}
      isPermissionDenied={isForbiddenError(loadError)}
      hasError={Boolean(loadError)}
      errorDescription="Your saved company settings are unchanged. Check your connection and try again."
      onRetry={() => void loadCompany()}
      backHref="/dashboard/settings"
      backLabel="Back to settings"
    >
      <form
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSave();
        }}
      >
        <FormSection title="Company profile" description="Primary business details shown across administrative and operational surfaces.">
          <FieldGroup className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="company-name">Company name <RequiredMark /></FieldLabel>
              <Input id="company-name" required maxLength={150} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
            </Field>
            <Field>
              <FieldLabel htmlFor="company-primary-email">Primary email</FieldLabel>
              <Input id="company-primary-email" type="email" maxLength={150} value={form.primary_email} onChange={(event) => setForm((current) => ({ ...current, primary_email: event.target.value }))} />
            </Field>
            <Field>
              <FieldLabel htmlFor="company-website">Website</FieldLabel>
              <Input id="company-website" type="url" maxLength={255} value={form.website} onChange={(event) => setForm((current) => ({ ...current, website: event.target.value }))} placeholder="https://company.com" />
            </Field>
            <Field>
              <FieldLabel htmlFor="company-primary-phone">Primary phone</FieldLabel>
              <Input id="company-primary-phone" type="tel" maxLength={50} value={form.primary_phone} onChange={(event) => setForm((current) => ({ ...current, primary_phone: event.target.value }))} />
            </Field>
            <Field>
              <FieldLabel htmlFor="company-industry">Industry</FieldLabel>
              <Input id="company-industry" maxLength={120} value={form.industry} onChange={(event) => setForm((current) => ({ ...current, industry: event.target.value }))} />
            </Field>
            <Field>
              <FieldLabel htmlFor="company-country">Country</FieldLabel>
              <Input id="company-country" maxLength={120} value={form.country} onChange={(event) => setForm((current) => ({ ...current, country: event.target.value }))} />
            </Field>
          </FieldGroup>
        </FormSection>

        <FormSection title="Commercial defaults" description="Shared currency and billing information used by commercial records.">
          <FieldGroup className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="company-operating-currencies">Operating currencies <RequiredMark /></FieldLabel>
              <Input
                id="company-operating-currencies"
                required
                pattern="([A-Za-z]{3})(\s*,\s*[A-Za-z]{3})*"
                title="Enter three-letter currency codes separated by commas."
                value={form.operating_currencies}
                onChange={(event) => setForm((current) => ({ ...current, operating_currencies: event.target.value }))}
                placeholder="USD, EUR, GBP"
              />
              <FieldDescription>Comma-separated three-letter ISO codes used across opportunities, insertion orders, and other commercial records.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="company-billing-address">Billing address</FieldLabel>
              <Textarea id="company-billing-address" value={form.billing_address} onChange={(event) => setForm((current) => ({ ...current, billing_address: event.target.value }))} rows={5} />
              <FieldDescription>One primary company record is supported. Multi-company tenancy remains deferred.</FieldDescription>
            </Field>
          </FieldGroup>
        </FormSection>

        {/* E5 (12c-erp-invoicing.md §3.5). */}
        <FormSection title="Invoicing" description="When orders become invoiceable, and when invoices and bills fall due.">
          <FieldGroup className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="company-invoicing-policy">Invoice stocked products when</FieldLabel>
              <Select value={form.invoicing_policy} onValueChange={(value) => setForm((current) => ({ ...current, invoicing_policy: value === "ordered" ? "ordered" : "delivered" }))}>
                <SelectTrigger id="company-invoicing-policy"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="delivered">They are delivered</SelectItem>
                  <SelectItem value="ordered">They are ordered</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>Services and products you do not stock are always invoiced as ordered.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="company-payment-terms">Default payment terms (days)</FieldLabel>
              <Input id="company-payment-terms" type="number" min={0} max={365} step={1} inputMode="numeric" value={form.default_payment_terms_days}
                onChange={(event) => setForm((current) => ({ ...current, default_payment_terms_days: event.target.value }))} placeholder="30" />
              <FieldDescription>Sets an invoice&apos;s or bill&apos;s due date when its account has no terms of its own. Blank leaves the due date open.</FieldDescription>
            </Field>
          </FieldGroup>
        </FormSection>

        <FormSection title="Branding" description="Manage the tenant company logo used across CRM documents and workspace surfaces.">
          <ImageAssetField
            id="company-logo-upload"
            label="Company logo"
            imageUrl={logoUrl}
            previewAlt="Company logo preview"
            uploadAriaLabel="Upload company logo"
            busyAction={logoBusyAction}
            error={logoError}
            onFileSelected={(file) => void handleLogoUpload(file)}
            onRemove={() => void handleLogoRemove()}
          />

          {/* The company profile is a configuration record — the fields validate together
              and one write commits them — so it keeps a manual save (archetype 4). What
              goes is the stickiness (R3) and the colour: R5 paints exception, and a form
              with unsaved edits is not one, so the dirty line is ordinary muted ink. The
              footer sits in the last section because the three sections are one record. */}
          <FormFooter status={actionError
            ? <span role="alert" className="text-state-danger">{actionError}</span>
            : isDirty ? "Unsaved changes" : null}>
            <Button type="button" variant="outline" disabled={!isDirty || saving || logoBusyAction !== null} onClick={() => void handleDiscard()}>
              <RotateCcw />
              Discard
            </Button>
            <Button type="submit" disabled={saving || logoBusyAction !== null || !isDirty || !form.name.trim()}>
              <Save />
              {saving ? "Saving\u2026" : "Save company"}
            </Button>
          </FormFooter>
        </FormSection>
      </form>
    </PageShell>
  );
}
