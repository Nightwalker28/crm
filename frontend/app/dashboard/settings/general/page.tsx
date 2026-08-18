"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/Card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { ImageAssetField, validateImageAssetFile } from "@/components/ui/ImageAssetField";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/hooks/useConfirm";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { apiFetch } from "@/lib/api";

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
  const [loadFailed, setLoadFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initialForm), [form, initialForm]);

  const loadCompany = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      setLoadFailed(false);
      const response = await apiFetch("/users/company", { signal });
      const body = await readJson(response);
      if (!response.ok) throw new Error("Company profile could not be loaded.");

      const nextForm = companyToForm(body as CompanyResponse);
      setForm(nextForm);
      setInitialForm(nextForm);
      setLogoUrl((body as CompanyResponse).logo_url ?? "");
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
      setLoadFailed(true);
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
      isLoading={loading && !loadFailed}
      hasError={loadFailed}
      errorDescription="Your saved company settings are unchanged. Check your connection and try again."
      onRetry={() => void loadCompany()}
      backHref="/dashboard/settings"
      backLabel="Back to settings"
    >
      {(
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSave();
          }}
        >
          {actionError ? (
            <div role="alert" className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
              {actionError}
            </div>
          ) : null}

          <Card aria-label="Company settings workspace">
            <CardHeader>
              <div>
                <h2 className="text-base font-semibold text-copy-primary">Company profile</h2>
                <p className="mt-1 text-p-sm text-copy-muted">Primary business details shown across administrative and operational surfaces.</p>
              </div>
            </CardHeader>
            <CardBody>
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
            </CardBody>
            <section className="border-t border-line-subtle">
            <CardHeader>
              <div>
                <h2 className="text-base font-semibold text-copy-primary">Commercial defaults</h2>
                <p className="mt-1 text-p-sm text-copy-muted">Shared currency and billing information used by commercial records.</p>
              </div>
            </CardHeader>
            <CardBody>
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
            </CardBody>
            </section>

            <section className="border-t border-line-subtle">
            <CardHeader>
              <div>
                <h2 className="text-base font-semibold text-copy-primary">Branding</h2>
                <p className="mt-1 text-p-sm text-copy-muted">Manage the tenant company logo used across CRM documents and workspace surfaces.</p>
              </div>
            </CardHeader>
            <CardBody>
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
            </CardBody>
            </section>

            <CardFooter className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-3 bg-surface-raised/95 backdrop-blur">
              <span className={`text-sm ${isDirty ? "text-state-warning" : "text-state-success"}`}>
                {isDirty ? "You have unsaved company changes." : "All company settings are saved."}
              </span>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={!isDirty || saving || logoBusyAction !== null} onClick={() => void handleDiscard()}>
                  <RotateCcw />
                  Discard
                </Button>
                <Button type="submit" disabled={saving || logoBusyAction !== null || !isDirty || !form.name.trim()}>
                  <Save />
                  {saving ? "Saving..." : "Save company"}
                </Button>
              </div>
            </CardFooter>
          </Card>
        </form>
      )}
    </PageShell>
  );
}
