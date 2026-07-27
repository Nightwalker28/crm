"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { FormSection, RecordFormLayout } from "@/components/forms/RecordFormLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDeniedState } from "@/components/ui/PermissionDeniedState";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { RouteErrorState, RouteLoadingState, RouteNotFoundState } from "@/components/ui/RouteStates";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { apiFetch } from "@/lib/api";
import { getModuleDisplayName } from "@/lib/module-display";
import {
  CHANNEL_OPTIONS,
  CRM_TEMPLATE_PRESETS,
  EMPTY_TEMPLATE_DRAFT,
  fetchMessageTemplates,
  mergedTemplateVariables,
  MODULE_OPTIONS,
  templateToDraft,
  type MessageTemplate,
  type TemplateDraft,
  VARIABLE_LIBRARY,
} from "@/lib/message-templates";

function TemplateEditor({ template }: { template: MessageTemplate | null }) {
  const router = useRouter();
  const nameRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const initialDraft = useMemo(() => template ? templateToDraft(template) : EMPTY_TEMPLATE_DRAFT, [template]);
  const [draft, setDraft] = useState<TemplateDraft>(initialDraft);
  const [error, setError] = useState<{ field: "name" | "body" | "form"; message: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveComplete, setSaveComplete] = useState(false);
  const isEdit = Boolean(template);
  const isDirty = JSON.stringify(draft) !== JSON.stringify(initialDraft);
  const visibleVariables = mergedTemplateVariables(draft.body, draft.variables);
  const suggestedVariables = Array.from(new Set([...(VARIABLE_LIBRARY.common ?? []), ...(VARIABLE_LIBRARY[draft.module_key] ?? [])]));
  useUnsavedChangesGuard(isDirty, saveComplete);

  function applyPreset(preset: (typeof CRM_TEMPLATE_PRESETS)[number]) {
    setDraft({
      name: preset.name,
      description: preset.description,
      channel: preset.channel,
      module_key: preset.module_key,
      body: preset.body,
      variables: mergedTemplateVariables(preset.body, "").join(", "),
      is_active: true,
    });
    setError(null);
  }

  async function saveTemplate() {
    if (!draft.name.trim()) {
      setError({ field: "name", message: "Enter a template name." });
      nameRef.current?.focus();
      return;
    }
    if (!draft.body.trim()) {
      setError({ field: "body", message: "Enter the template body." });
      bodyRef.current?.focus();
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const res = await apiFetch(template ? `/message-templates/${template.id}` : "/message-templates", {
        method: template ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          description: draft.description.trim() || null,
          channel: draft.channel,
          module_key: draft.module_key || null,
          body: draft.body.trim(),
          variables: visibleVariables,
          is_active: draft.is_active,
        }),
      });
      if (!res.ok) {
        setError({
          field: "form",
          message: res.status === 409 ? "A template with this name already exists." : "We could not save this template. Review the fields and try again.",
        });
        return;
      }
      const saved = await res.json() as MessageTemplate;
      setSaveComplete(true);
      toast.success(template ? "Template updated." : "Template created.");
      router.push(`/dashboard/settings/message-templates?savedTemplateId=${saved.id}`);
    } catch {
      setError({ field: "form", message: "We could not save this template. Check your connection and try again." });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title={template ? "Edit message template" : "Create message template"}
        description="Prepare reusable WhatsApp or email content with CRM variables."
        actions={<Button asChild variant="outline"><Link href="/dashboard/settings/message-templates"><ArrowLeft />Back to templates</Link></Button>}
      />
      <RecordFormLayout
        sidebar={
          <>
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-copy-primary">Template summary</h2>
              <dl className="mt-4 grid gap-3 text-sm">
                <div><dt className="text-copy-muted">Channel</dt><dd className="mt-1 text-copy-primary">{CHANNEL_OPTIONS.find((item) => item.value === draft.channel)?.label ?? draft.channel}</dd></div>
                <div><dt className="text-copy-muted">Module</dt><dd className="mt-1 text-copy-primary">{getModuleDisplayName(draft.module_key)}</dd></div>
                <div><dt className="text-copy-muted">Variables</dt><dd className="mt-1 text-copy-primary">{visibleVariables.length}</dd></div>
                <div><dt className="text-copy-muted">Status</dt><dd className="mt-1 text-copy-primary">{draft.is_active ? "Active" : "Inactive"}</dd></div>
              </dl>
            </Card>
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-copy-primary">Suggested variables</h2>
              <p className="mt-2 text-sm leading-6 text-copy-secondary">Choose a token to declare it for this template.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {suggestedVariables.map((variable) => (
                  <button key={variable} type="button" className="rounded-full border border-line-default bg-surface-muted px-2.5 py-1 text-xs text-copy-secondary hover:border-line-strong hover:text-copy-primary" onClick={() => setDraft((current) => ({ ...current, variables: mergedTemplateVariables(current.body, `${current.variables}, ${variable}`).join(", ") }))}>
                    {`{{${variable}}}`}
                  </button>
                ))}
              </div>
            </Card>
          </>
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-copy-muted">{isDirty ? "Unsaved template changes" : "No unsaved changes"}</span>
            <div className="flex gap-2">
              <Button asChild variant="outline"><Link href="/dashboard/settings/message-templates">Cancel</Link></Button>
              <Button type="button" onClick={() => void saveTemplate()} disabled={isSaving}>
                <Save />{isSaving ? "Saving..." : isEdit ? "Save template" : "Create template"}
              </Button>
            </div>
          </div>
        }
      >
        {!isEdit ? <FormSection title="Start from a preset" description="Presets are editable starting points and do not send messages.">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {CRM_TEMPLATE_PRESETS.map((preset) => <Button key={preset.label} type="button" variant="outline" className="justify-start" onClick={() => applyPreset(preset)}><Sparkles />{preset.label}</Button>)}
          </div>
        </FormSection> : null}
        <FormSection title="Template details" description="Name the template and choose where it is available.">
          <FieldGroup>
            <Field data-invalid={error?.field === "name"}>
              <FieldLabel htmlFor="template-name">Name <RequiredMark /></FieldLabel>
              <Input ref={nameRef} id="template-name" value={draft.name} maxLength={180} onChange={(event) => { setDraft((current) => ({ ...current, name: event.target.value })); setError(null); }} aria-invalid={error?.field === "name"} placeholder="Quote follow-up" />
              {error?.field === "name" ? <FieldError>{error.message}</FieldError> : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="template-description">Description</FieldLabel>
              <Input id="template-description" value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel>Channel <RequiredMark /></FieldLabel>
                <Select value={draft.channel} onValueChange={(value) => setDraft((current) => ({ ...current, channel: value }))}><SelectTrigger aria-label="Channel"><SelectValue /></SelectTrigger><SelectContent>{CHANNEL_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select>
              </Field>
              <Field>
                <FieldLabel>Module <RequiredMark /></FieldLabel>
                <Select value={draft.module_key} onValueChange={(value) => setDraft((current) => ({ ...current, module_key: value }))}><SelectTrigger aria-label="Module"><SelectValue /></SelectTrigger><SelectContent>{MODULE_OPTIONS.map((moduleName) => <SelectItem key={moduleName} value={moduleName}>{getModuleDisplayName(moduleName)}</SelectItem>)}</SelectContent></Select>
              </Field>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-3 py-2 text-sm text-copy-primary">
              Active
              <Checkbox
                checked={draft.is_active}
                onCheckedChange={(checked) => setDraft((current) => ({ ...current, is_active: checked === true }))}
                aria-label="Active"
              />
            </label>
          </FieldGroup>
        </FormSection>
        <FormSection title="Message content" description="Variables wrapped in braces are detected and saved automatically.">
          <FieldGroup>
            <Field data-invalid={error?.field === "body" || error?.field === "form"}>
              <FieldLabel htmlFor="template-body">Body <RequiredMark /></FieldLabel>
              <Textarea ref={bodyRef} id="template-body" value={draft.body} onChange={(event) => { setDraft((current) => ({ ...current, body: event.target.value })); setError(null); }} className="min-h-48" aria-invalid={error?.field === "body" || error?.field === "form"} />
              <FieldDescription>Example: {"{{first_name}}"}, your quote is ready.</FieldDescription>
              {error?.field === "body" || error?.field === "form" ? <FieldError>{error.message}</FieldError> : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="template-variables">Additional variables</FieldLabel>
              <Input id="template-variables" value={draft.variables} onChange={(event) => setDraft((current) => ({ ...current, variables: event.target.value }))} placeholder="contact_first_name, organization_name" />
              {visibleVariables.length ? <div className="mt-2 flex flex-wrap gap-2">{visibleVariables.map((variable) => <span key={variable} className="rounded-full border border-line-default bg-surface-muted px-2 py-1 text-xs text-copy-secondary">{`{{${variable}}}`}</span>)}</div> : null}
            </Field>
          </FieldGroup>
        </FormSection>
      </RecordFormLayout>
    </div>
  );
}

export default function MessageTemplateRecordFormPage({ templateId = null }: { templateId?: number | null }) {
  const { modules, isLoading: modulesLoading } = useAccessibleModules();
  const actions = modules.find((module) => module.name === "message_templates")?.actions;
  const permitted = templateId === null ? actions?.can_create : actions?.can_edit;
  const templatesQuery = useQuery({ queryKey: ["message-templates", "all"], queryFn: fetchMessageTemplates, enabled: templateId !== null });

  if (modulesLoading || (templateId !== null && templatesQuery.isLoading)) return <RouteLoadingState label="message template" />;
  if (!permitted) return <PermissionDeniedState />;
  if (templatesQuery.error) return <RouteErrorState title="Unable to load this template" reset={() => void templatesQuery.refetch()} backHref="/dashboard/settings/message-templates" backLabel="Back to templates" />;
  const template = templateId === null ? null : templatesQuery.data?.find((item) => item.id === templateId) ?? null;
  if (templateId !== null && !template) return <RouteNotFoundState recordLabel="Message template" backHref="/dashboard/settings/message-templates" backLabel="Back to templates" />;
  return <TemplateEditor key={template?.id ?? "new"} template={template} />;
}
