"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Textarea } from "@/components/ui/textarea";
import { resolveMediaUrl } from "@/lib/media";

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
  logo_url: string;
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
  logo_url: "",
};

function RequiredMark() {
  return <span className="text-red-400">*</span>;
}

export default function CompanyPage() {
  const [form, setForm] = useState<CompanyForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await apiFetch("/users/company");
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(body?.detail ?? `Failed with ${res.status}`);
        }
        if (cancelled) return;

        const data = body as CompanyResponse;
        setForm({
          name: data.name ?? "",
          primary_email: data.primary_email ?? "",
          website: data.website ?? "",
          primary_phone: data.primary_phone ?? "",
          industry: data.industry ?? "",
          country: data.country ?? "",
          operating_currencies: Array.isArray(data.operating_currencies) && data.operating_currencies.length
            ? data.operating_currencies.join(", ")
            : "USD",
          billing_address: data.billing_address ?? "",
          logo_url: data.logo_url ?? "",
        });
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load company profile");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    try {
      setSaving(true);
      setError(null);

      const payload = {
        name: form.name.trim() || null,
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
        logo_url: form.logo_url.trim() || null,
      };

      const res = await apiFetch("/users/company", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.detail ?? `Failed with ${res.status}`);
      }

      toast.success("Company profile updated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save company profile");
    } finally {
      setSaving(false);
    }
  }

  async function handleLogoUpload(file: File) {
    try {
      setUploadingLogo(true);
      setError(null);

      const formData = new FormData();
      formData.append("file", file);

      const res = await apiFetch("/users/company/logo", {
        method: "POST",
        body: formData,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.detail ?? `Failed with ${res.status}`);
      }

      setForm((current) => ({ ...current, logo_url: body.logo_url ?? "" }));
      toast.success("Company logo uploaded.");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Failed to upload company logo");
    } finally {
      setUploadingLogo(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <PageHeader
        title="Company"
        description="Manage the primary company record used across the admin and operations surfaces."
      />

      {error ? (
        <div className="rounded-md border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <Card className="px-5 py-5">
        {loading ? (
          <div className="text-sm text-neutral-500">Loading company profile...</div>
        ) : (
          <div className="space-y-6">
            <FieldGroup className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel>Company Name <RequiredMark /></FieldLabel>
                <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
              </Field>
              <Field>
                <FieldLabel>Primary Email</FieldLabel>
                <Input type="email" value={form.primary_email} onChange={(event) => setForm((current) => ({ ...current, primary_email: event.target.value }))} />
              </Field>
              <Field>
                <FieldLabel>Website</FieldLabel>
                <Input value={form.website} onChange={(event) => setForm((current) => ({ ...current, website: event.target.value }))} placeholder="https://company.com" />
              </Field>
              <Field>
                <FieldLabel>Primary Phone</FieldLabel>
                <Input value={form.primary_phone} onChange={(event) => setForm((current) => ({ ...current, primary_phone: event.target.value }))} />
              </Field>
              <Field>
                <FieldLabel>Industry</FieldLabel>
                <Input value={form.industry} onChange={(event) => setForm((current) => ({ ...current, industry: event.target.value }))} />
              </Field>
              <Field>
                <FieldLabel>Country</FieldLabel>
                <Input value={form.country} onChange={(event) => setForm((current) => ({ ...current, country: event.target.value }))} />
              </Field>
              <Field>
                <FieldLabel>Operating Currencies <RequiredMark /></FieldLabel>
                <Input
                  value={form.operating_currencies}
                  onChange={(event) => setForm((current) => ({ ...current, operating_currencies: event.target.value }))}
                  placeholder="USD, EUR, GBP"
                />
                <FieldDescription>Comma-separated ISO currency codes used across opportunities, insertion orders, and other commercial records.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel>Logo URL</FieldLabel>
                <Input value={form.logo_url} onChange={(event) => setForm((current) => ({ ...current, logo_url: event.target.value }))} placeholder="https://..." />
                <div className="mt-3 flex items-center gap-3">
                  {form.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={resolveMediaUrl(form.logo_url)}
                      alt="Company logo preview"
                      className="h-12 w-12 rounded-lg border border-neutral-800 object-cover"
                    />
                  ) : null}
                  <label className="inline-flex cursor-pointer items-center rounded-md border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-900">
                    {uploadingLogo ? "Uploading..." : "Upload Logo"}
                    <input
                      type="file"
                      accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void handleLogoUpload(file);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                </div>
              </Field>
              <Field className="md:col-span-2">
                <FieldLabel>Billing Address</FieldLabel>
                <Textarea value={form.billing_address} onChange={(event) => setForm((current) => ({ ...current, billing_address: event.target.value }))} rows={4} />
                <FieldDescription>One primary company record is supported in this increment. Multi-company per tenant stays deferred.</FieldDescription>
              </Field>
            </FieldGroup>

            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
                {saving ? "Saving..." : "Save Company"}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
