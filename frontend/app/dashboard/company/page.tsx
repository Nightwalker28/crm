"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type CompanyResponse = {
  id: number;
  name: string;
  primary_email?: string | null;
  website?: string | null;
  primary_phone?: string | null;
  industry?: string | null;
  country?: string | null;
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

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <div>
        <h1 className="text-2xl font-semibold leading-none">Company</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Manage the primary company record used across the admin and operations surfaces.
        </p>
      </div>

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
                <FieldLabel>Logo URL</FieldLabel>
                <Input value={form.logo_url} onChange={(event) => setForm((current) => ({ ...current, logo_url: event.target.value }))} placeholder="https://..." />
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
