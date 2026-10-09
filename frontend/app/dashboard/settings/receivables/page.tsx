"use client";

import { useState } from "react";
import { BellRing, Plus, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EditorPanel } from "@/components/ui/EditorPanel";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { RecordTable } from "@/components/ui/RecordTable";
import { RequiredMark } from "@/components/ui/RequiredMark";
import type { SaveState } from "@/components/ui/SaveStateIndicator";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { SegmentedBoolean, SegmentedControl, SegmentedItem } from "@/components/ui/SegmentedControl";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { StatusValue } from "@/components/ui/StatusValue";
import { Textarea } from "@/components/ui/textarea";
import { jsonBody, receivablesRequest, reminderDayLabel, useReminderRules, type ReminderRule } from "@/hooks/finance/useReceivables";
import { useConfirm } from "@/hooks/useConfirm";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { isForbiddenError } from "@/lib/api";
import { SETTINGS_ROUTES } from "@/lib/routes";
import { getCatalogActiveState } from "@/lib/statusStyles";

type When = "before" | "on" | "after";
type Draft = { name: string; when: When; days: string; subject: string; body: string; attach_pdf: boolean; active: boolean };

const EMPTY_DRAFT: Draft = {
  name: "", when: "after", days: "1", subject: "Invoice {{document.number}} is overdue",
  body: "Hello {{contact.first_name}},\n\nInvoice {{document.number}} for {{document.currency}} {{document.balance_due}} was due on {{document.due_date}}.\n\nKind regards,\n{{company.name}}",
  attach_pdf: true, active: false,
};
const TOKENS = ["{{contact.first_name}}", "{{customer.name}}", "{{document.number}}", "{{document.balance_due}}", "{{document.currency}}",
  "{{document.due_date}}", "{{document.days_overdue}}", "{{company.name}}"];

function draftFrom(rule: ReminderRule): Draft {
  return {
    name: rule.name, when: rule.days_offset < 0 ? "before" : rule.days_offset === 0 ? "on" : "after", days: String(Math.abs(rule.days_offset) || 1),
    subject: rule.subject, body: rule.body, attach_pdf: rule.attach_pdf, active: rule.active,
  };
}

function offsetOf(draft: Draft) {
  if (draft.when === "on") return 0;
  return (draft.when === "before" ? -1 : 1) * Number(draft.days);
}

/**
 * Settings → Receivables (13d §3.6): the payment reminders emailed for unpaid invoices, and
 * how much anyone who edits invoices may write off. Reminders are off until turned on
 * (decision 12) and go out once a day through the workspace sender.
 */
export default function ReceivablesSettingsPage() {
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const rules = useReminderRules();
  const company = useQuery({
    queryKey: ["company-write-off-limit"],
    queryFn: () => receivablesRequest<{ write_off_limit: number; base_currency?: string | null }>("/users/company"),
  });
  const [limitState, setLimitState] = useState<SaveState>("idle");
  const [editing, setEditing] = useState<ReminderRule | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const initial = editing ? draftFrom(editing) : EMPTY_DRAFT;
  const isDirty = open && JSON.stringify(draft) !== JSON.stringify(initial);

  const saveRule = useMutation({
    mutationFn: ({ id, payload }: { id: number | null; payload: Record<string, unknown> }) =>
      receivablesRequest<ReminderRule>(id ? `/finance/reminder-rules/${id}` : "/finance/reminder-rules", jsonBody(id ? "PATCH" : "POST", payload),
        "The reminder could not be saved."),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reminder-rules"] }),
  });
  useUnsavedChangesGuard(isDirty, saveRule.isPending);

  function openEditor(rule: ReminderRule | null) {
    setEditing(rule);
    setDraft(rule ? draftFrom(rule) : EMPTY_DRAFT);
    setErrors({});
    setSaveError(null);
    setOpen(true);
  }

  async function closeEditor() {
    if (isDirty && !(await confirm({ title: "Discard changes?", description: "This reminder's changes are not saved.", confirmLabel: "Discard", variant: "destructive" }))) return;
    setOpen(false);
  }

  async function save() {
    const next: typeof errors = {};
    if (!draft.name.trim()) next.name = "Name the reminder.";
    const days = Number(draft.days);
    if (draft.when !== "on" && (!Number.isInteger(days) || days < 1 || days > (draft.when === "before" ? 60 : 365))) {
      next.days = draft.when === "before" ? "Enter 1 to 60 days." : "Enter 1 to 365 days.";
    }
    if (!draft.subject.trim()) next.subject = "Enter the subject.";
    if (!draft.body.trim()) next.body = "Enter the message.";
    setErrors(next);
    if (Object.keys(next).length) return;
    try {
      setSaveError(null);
      await saveRule.mutateAsync({ id: editing?.id ?? null, payload: {
        name: draft.name.trim(), days_offset: offsetOf(draft), subject: draft.subject.trim(), body: draft.body.trim(),
        attach_pdf: draft.attach_pdf, active: draft.active,
      } });
      toast.success(editing ? "Reminder saved." : "Reminder added.");
      setOpen(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "The reminder could not be saved.");
    }
  }

  async function toggle(rule: ReminderRule, active: boolean) {
    try {
      await saveRule.mutateAsync({ id: rule.id, payload: { active } });
      toast.success(active ? `${rule.name} is on.` : `${rule.name} is off.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The reminder could not be changed.");
    }
  }

  async function remove(rule: ReminderRule) {
    if (!(await confirm({ title: `Delete ${rule.name}?`, description: "Reminders already sent stay on their invoices.", confirmLabel: "Delete", variant: "destructive" }))) return;
    try {
      await receivablesRequest(`/finance/reminder-rules/${rule.id}`, { method: "DELETE" }, "The reminder could not be deleted.");
      await queryClient.invalidateQueries({ queryKey: ["reminder-rules"] });
      toast.success("Reminder deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The reminder could not be deleted.");
    }
  }

  async function saveLimit(value: string) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) { toast.error("Enter an amount of 0 or more."); return; }
    if (amount === Number(company.data?.write_off_limit ?? 0)) return;
    try {
      setLimitState("saving");
      await receivablesRequest("/users/company", jsonBody("PUT", { write_off_limit: amount }), "The limit could not be saved.");
      await queryClient.invalidateQueries({ queryKey: ["company-write-off-limit"] });
      setLimitState("saved");
    } catch {
      setLimitState("error");
    }
  }

  return (
    <PageShell
      variant="settings"
      title="Receivables"
      description="Payment reminders for unpaid invoices, and how much can be written off."
      actions={<Button type="button" onClick={() => openEditor(null)}><Plus />Add reminder</Button>}
      isPermissionDenied={isForbiddenError(rules.error) || isForbiddenError(company.error)}
      backHref={SETTINGS_ROUTES.root}
      backLabel="Back to settings"
    >
      {company.data ? (
        <SettingsRow
          label="Write-off limit"
          saveState={limitState}
          description={`Anyone who edits invoices can write off a balance up to this, in the invoice's currency. Above it, only finance administrators can. 0 leaves it to them alone.`}
        >
          <Input
            key={String(company.data.write_off_limit)}
            aria-label="Write-off limit"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            className="max-w-36"
            defaultValue={company.data.write_off_limit}
            onBlur={(event) => void saveLimit(event.target.value)}
          />
        </SettingsRow>
      ) : null}

      <div className="flex flex-col gap-3">
        <SectionHeading description="Emailed once a day, through the workspace sender (Settings → Integrations), to the invoice's customer. Each reminder is sent once per invoice; accounts marked No payment reminders are skipped.">
          Payment reminders
        </SectionHeading>
        <RecordTable
          label="Payment reminders"
          columns={[
            { key: "name", label: "Name", size: "lg", render: (rule) => <span className="font-medium text-copy-primary">{rule.name}</span> },
            { key: "when", label: "Sent", size: "md", render: (rule) => reminderDayLabel(rule.days_offset) },
            { key: "subject", label: "Subject", size: "lg", render: (rule) => <span className="text-copy-secondary">{rule.subject}</span> },
            { key: "status", label: "Status", size: "sm", render: (rule) => <StatusValue status={getCatalogActiveState(rule.active)} /> },
          ]}
          rows={rules.data ?? []}
          rowKey={(rule) => rule.id}
          onOpenRow={(rule) => openEditor(rule)}
          rowLabel={(rule) => `Edit ${rule.name}`}
          isLoading={rules.isLoading}
          isRefreshing={rules.isFetching && !rules.isLoading}
          isPermissionDenied={isForbiddenError(rules.error)}
          hasError={Boolean(rules.error) && !isForbiddenError(rules.error)}
          onRetry={() => void rules.refetch()}
          errorState={{ title: "Payment reminders could not be loaded" }}
          emptyState={{
            icon: BellRing,
            title: "No payment reminders",
            description: "Add one to email customers before or after an invoice falls due.",
            action: <Button type="button" onClick={() => openEditor(null)}><Plus />Add reminder</Button>,
          }}
          rowActions={(rule) => (
            <>
              <Button type="button" size="sm" variant="ghost" onClick={() => void toggle(rule, !rule.active)}>{rule.active ? "Turn off" : "Turn on"}</Button>
              <Button type="button" size="icon" variant="ghost" aria-label={`Delete ${rule.name}`} onClick={() => void remove(rule)}><Trash2 /></Button>
            </>
          )}
        />
      </div>

      <EditorPanel
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : void closeEditor())}
        title={editing ? `Edit ${editing.name}` : "Add payment reminder"}
        description="The message is plain text. The tokens below fill in from each invoice."
        closeLabel="Close reminder editor"
        onSubmit={() => void save()}
        status={saveError ? <span role="alert" className="text-state-danger">{saveError}</span> : isDirty ? "Unsaved changes" : null}
        footer={(
          <>
            <Button type="button" variant="outline" onClick={() => void closeEditor()} disabled={saveRule.isPending}>Cancel</Button>
            <Button type="submit" disabled={saveRule.isPending || (Boolean(editing) && !isDirty)}>{saveRule.isPending ? "Saving…" : editing ? "Save" : "Add"}</Button>
          </>
        )}
      >
        <FieldGroup>
          <Field data-invalid={Boolean(errors.name)}>
            <FieldLabel htmlFor="reminder-name">Name <RequiredMark /></FieldLabel>
            <Input id="reminder-name" value={draft.name} maxLength={200} onChange={(event) => setDraft({ ...draft, name: event.target.value })} aria-invalid={Boolean(errors.name)} />
            {errors.name ? <FieldError>{errors.name}</FieldError> : null}
          </Field>
          <Field>
            <FieldLabel>Send</FieldLabel>
            <SegmentedControl value={draft.when} onValueChange={(when) => setDraft({ ...draft, when: when as When })} aria-label="Send">
              <SegmentedItem value="before">Before the due date</SegmentedItem>
              <SegmentedItem value="on">On it</SegmentedItem>
              <SegmentedItem value="after">After it</SegmentedItem>
            </SegmentedControl>
          </Field>
          {draft.when !== "on" ? (
            <Field data-invalid={Boolean(errors.days)}>
              <FieldLabel htmlFor="reminder-days">Days {draft.when}</FieldLabel>
              <Input id="reminder-days" type="number" inputMode="numeric" min={1} className="max-w-24" value={draft.days}
                onChange={(event) => setDraft({ ...draft, days: event.target.value })} aria-invalid={Boolean(errors.days)} />
              {errors.days ? <FieldError>{errors.days}</FieldError> : null}
            </Field>
          ) : null}
          <Field data-invalid={Boolean(errors.subject)}>
            <FieldLabel htmlFor="reminder-subject">Subject <RequiredMark /></FieldLabel>
            <Input id="reminder-subject" value={draft.subject} maxLength={300} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} aria-invalid={Boolean(errors.subject)} />
            {errors.subject ? <FieldError>{errors.subject}</FieldError> : null}
          </Field>
          <Field data-invalid={Boolean(errors.body)}>
            <FieldLabel htmlFor="reminder-body">Message <RequiredMark /></FieldLabel>
            <Textarea id="reminder-body" rows={8} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} aria-invalid={Boolean(errors.body)} />
            <FieldDescription>Tokens: {TOKENS.join(", ")}</FieldDescription>
            {errors.body ? <FieldError>{errors.body}</FieldError> : null}
          </Field>
          <Field>
            <FieldLabel>Invoice PDF</FieldLabel>
            <SegmentedBoolean aria-label="Invoice PDF" value={draft.attach_pdf} onValueChange={(attach_pdf) => setDraft({ ...draft, attach_pdf })} trueLabel="Attach" falseLabel="Don't attach" />
          </Field>
          <Field>
            <FieldLabel>Status</FieldLabel>
            <SegmentedBoolean aria-label="Status" value={draft.active} onValueChange={(active) => setDraft({ ...draft, active })} trueLabel="On" falseLabel="Off" />
            <FieldDescription>Once on, it goes out from the next daily run.</FieldDescription>
          </Field>
        </FieldGroup>
      </EditorPanel>
    </PageShell>
  );
}
