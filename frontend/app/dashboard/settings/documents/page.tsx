"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EditorPanel } from "@/components/ui/EditorPanel";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { RecordTable } from "@/components/ui/RecordTable";
import type { SaveState } from "@/components/ui/SaveStateIndicator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SegmentedControl, SegmentedItem } from "@/components/ui/SegmentedControl";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { Textarea } from "@/components/ui/textarea";
import { useEmailTemplates } from "@/hooks/useRecordMail";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { ApiError, apiFetch, isForbiddenError } from "@/lib/api";
import { SETTINGS_ROUTES } from "@/lib/routes";

type Branding = {
  document_layout: string;
  brand_color: string | null;
  document_footer: string | null;
  bank_details: string | null;
  quote_validity_days: number;
};
type DocumentSetting = {
  kind: string;
  label: string;
  module_key: string;
  title: string | null;
  default_terms: string | null;
  default_notes: string | null;
  email_template_id: number | null;
};
type Draft = { title: string; default_terms: string; default_notes: string; email_template_id: string };

const NO_TEMPLATE = "none";
const LAYOUTS = [
  { value: "modern", label: "Modern" },
  { value: "classic", label: "Classic" },
  { value: "compact", label: "Compact" },
];

async function json<T>(path: string, init: RequestInit = {}, fallback = "The settings could not be saved."): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: unknown } | null;
    throw new ApiError(res.status, res.status < 500 && typeof body?.detail === "string" ? body.detail : fallback);
  }
  return res.json() as Promise<T>;
}

function draftFrom(setting: DocumentSetting): Draft {
  return {
    title: setting.title ?? "",
    default_terms: setting.default_terms ?? "",
    default_notes: setting.default_notes ?? "",
    email_template_id: setting.email_template_id ? String(setting.email_template_id) : NO_TEMPLATE,
  };
}

/**
 * Settings → Documents (13d §3.3): how every PDF looks, and per document type its printed
 * title, the terms and notes new documents start with, and the email template *Send* uses.
 */
export default function DocumentSettingsPage() {
  const queryClient = useQueryClient();
  const branding = useQuery({ queryKey: ["company-document-branding"], queryFn: () => json<Branding>("/users/company", {}, "The settings could not be loaded.") });
  const settings = useQuery({
    queryKey: ["document-settings"],
    queryFn: async () => (await json<{ items: DocumentSetting[] }>("/document-settings", {}, "The settings could not be loaded.")).items,
  });
  const templates = useEmailTemplates();
  const [brandState, setBrandState] = useState<SaveState>("idle");
  const [editing, setEditing] = useState<DocumentSetting | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const saveBranding = useMutation({
    mutationFn: (patch: Partial<Branding>) => json<Branding>("/users/company", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
    }),
    onMutate: () => setBrandState("saving"),
    onSuccess: async () => {
      setBrandState("saved");
      await queryClient.invalidateQueries({ queryKey: ["company-document-branding"] });
    },
    onError: () => setBrandState("error"),
  });
  const saveSetting = useMutation({
    mutationFn: ({ kind, payload }: { kind: string; payload: Record<string, unknown> }) => json<{ items: DocumentSetting[] }>(`/document-settings/${kind}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    }),
    onSuccess: (body) => queryClient.setQueryData(["document-settings"], body.items),
  });

  const initial = editing ? draftFrom(editing) : null;
  const isDirty = Boolean(draft && initial && JSON.stringify(draft) !== JSON.stringify(initial));
  useUnsavedChangesGuard(isDirty, saveSetting.isPending);

  async function save() {
    if (!editing || !draft) return;
    try {
      setSaveError(null);
      await saveSetting.mutateAsync({
        kind: editing.kind,
        payload: {
          title: draft.title.trim() || null,
          default_terms: draft.default_terms.trim() || null,
          default_notes: draft.default_notes.trim() || null,
          email_template_id: draft.email_template_id === NO_TEMPLATE ? null : Number(draft.email_template_id),
        },
      });
      toast.success(`${editing.label} settings saved.`);
      setEditing(null);
      setDraft(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "The settings could not be saved.");
    }
  }

  const brand = branding.data;
  return (
    <PageShell
      variant="settings"
      title="Documents"
      description="How quotes, orders, invoices and purchase documents look as PDFs, and what new ones start with."
      isPermissionDenied={isForbiddenError(settings.error) || isForbiddenError(branding.error)}
      backHref={SETTINGS_ROUTES.root}
      backLabel="Back to settings"
    >
      {brand ? (
        <div className="flex flex-col gap-2">
          <SettingsRow label="Layout" description="Every PDF uses it; an invoice can still pick its own." saveState={brandState}>
            <SegmentedControl value={brand.document_layout} onValueChange={(document_layout) => saveBranding.mutate({ document_layout })} aria-label="Layout">
              {LAYOUTS.map((layout) => <SegmentedItem key={layout.value} value={layout.value}>{layout.label}</SegmentedItem>)}
            </SegmentedControl>
          </SettingsRow>
          <SettingsRow label="Brand colour" description="The accent on headings and rules. A hex colour, like #0f766e.">
            <Input
              key={brand.brand_color ?? ""}
              aria-label="Brand colour"
              defaultValue={brand.brand_color ?? ""}
              placeholder="#0f766e"
              className="max-w-40"
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (value === (brand.brand_color ?? "")) return;
                if (value && !/^#[0-9a-fA-F]{6}$/.test(value)) { toast.error("Enter a colour like #0f766e."); return; }
                saveBranding.mutate({ brand_color: value || null });
              }}
            />
          </SettingsRow>
          <SettingsRow label="Quotes valid for" description="Days from the issue date; sets a new quote's expiry. A quote past it can no longer be accepted.">
            <Input
              key={`validity-${brand.quote_validity_days}`}
              aria-label="Quotes valid for, in days"
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              defaultValue={brand.quote_validity_days}
              className="max-w-28"
              onBlur={(event) => {
                const days = Number(event.target.value);
                if (days === brand.quote_validity_days) return;
                if (!Number.isInteger(days) || days < 1 || days > 365) { toast.error("Enter a whole number of days from 1 to 365."); return; }
                saveBranding.mutate({ quote_validity_days: days }, {
                  onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["company-quote-validity-days"] }),
                });
              }}
            />
          </SettingsRow>
          <SettingsRow label="Payment details" description="Printed on invoices: bank account, payment link or instructions.">
            <Textarea
              key={`bank-${brand.bank_details ?? ""}`}
              aria-label="Payment details"
              defaultValue={brand.bank_details ?? ""}
              rows={3}
              onBlur={(event) => {
                if (event.target.value.trim() !== (brand.bank_details ?? "")) saveBranding.mutate({ bank_details: event.target.value.trim() || null });
              }}
            />
          </SettingsRow>
          <SettingsRow label="Footer" description="Printed at the bottom of every document: registration number, address, website.">
            <Textarea
              key={`footer-${brand.document_footer ?? ""}`}
              aria-label="Footer"
              defaultValue={brand.document_footer ?? ""}
              rows={2}
              onBlur={(event) => {
                if (event.target.value.trim() !== (brand.document_footer ?? "")) saveBranding.mutate({ document_footer: event.target.value.trim() || null });
              }}
            />
          </SettingsRow>
        </div>
      ) : null}

      <EditorPanel
        open={Boolean(editing)}
        onOpenChange={(open) => { if (!open) { setEditing(null); setDraft(null); } }}
        title={editing ? editing.label : "Document type"}
        description="New documents of this type start with these texts; each one can still change them."
        closeLabel="Close document type settings"
        onSubmit={() => void save()}
        status={saveError ? <span role="alert" className="text-state-danger">{saveError}</span> : isDirty ? "Unsaved changes" : null}
        footer={(
          <>
            <Button type="button" variant="outline" onClick={() => { setEditing(null); setDraft(null); }} disabled={saveSetting.isPending}>Cancel</Button>
            <Button type="submit" disabled={saveSetting.isPending || !isDirty}>{saveSetting.isPending ? "Saving…" : "Save"}</Button>
          </>
        )}
      >
        {draft && editing ? (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="document-title">Printed title</FieldLabel>
              <Input id="document-title" value={draft.title} maxLength={120} placeholder={editing.label}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
              <FieldDescription>Blank prints &ldquo;{editing.label}&rdquo;. Some countries need &ldquo;Tax invoice&rdquo;.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="document-terms">Default terms</FieldLabel>
              <Textarea id="document-terms" rows={5} value={draft.default_terms} onChange={(event) => setDraft({ ...draft, default_terms: event.target.value })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="document-notes">Default notes</FieldLabel>
              <Textarea id="document-notes" rows={3} value={draft.default_notes} onChange={(event) => setDraft({ ...draft, default_notes: event.target.value })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="document-email-template">Email template</FieldLabel>
              <Select value={draft.email_template_id} onValueChange={(email_template_id) => setDraft({ ...draft, email_template_id })}>
                <SelectTrigger id="document-email-template" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TEMPLATE}>None</SelectItem>
                  {(templates.data ?? []).map((template) => <SelectItem key={template.id} value={String(template.id)}>{template.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <FieldDescription>What *Send* starts with for this type.</FieldDescription>
            </Field>
          </FieldGroup>
        ) : null}
      </EditorPanel>

      <RecordTable
        label="Document types"
        columns={[
          { key: "label", label: "Document", size: "md", render: (row) => <span className="font-medium text-copy-primary">{row.label}</span> },
          { key: "title", label: "Printed title", size: "md", render: (row) => row.title ?? <span className="text-copy-muted">{row.label}</span> },
          {
            key: "texts", label: "Starts with", size: "lg",
            render: (row) => <span className="text-sm text-copy-secondary">{[row.default_terms ? "Terms" : null, row.default_notes ? "Notes" : null, row.email_template_id ? "Email template" : null].filter(Boolean).join(", ") || "—"}</span>,
          },
        ]}
        rows={settings.data ?? []}
        rowKey={(row) => row.kind}
        onOpenRow={(row) => { setEditing(row); setDraft(draftFrom(row)); setSaveError(null); }}
        rowLabel={(row) => `Edit ${row.label}`}
        isLoading={settings.isLoading}
        isPermissionDenied={isForbiddenError(settings.error)}
        hasError={Boolean(settings.error) && !isForbiddenError(settings.error)}
        onRetry={() => void settings.refetch()}
        errorState={{ title: "Document settings could not be loaded" }}
        emptyState={{ icon: FileText, title: "No document types" }}
      />
    </PageShell>
  );
}
