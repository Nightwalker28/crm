"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";

import { FormErrorBanner } from "@/components/forms/FormErrorBanner";
import { ServerFieldErrorsProvider, useServerFormErrors } from "@/components/forms/ServerFieldErrors";
import { RecordFormLayout } from "@/components/forms/RecordFormLayout";
import { useRecordTabHref } from "@/components/recordWorkspace/RecordWorkspace";
import { LayoutRecordFormBody } from "@/components/forms/LayoutRecordFormBody";
import { validateLayoutDrivenQuickCreate } from "@/components/forms/quickCreateLayout";
import { EMPTY_LEAD_FORM, LEAD_FORM_INPUT_IDS, type LeadFormValue, leadFormInputIdFor, useLeadStatusDefault } from "@/components/leads/LeadFormFields";
import { buildLeadPayload, saveLead, toDatetimeLocalValue, validateLeadEmail } from "@/components/leads/leadMutation";
import { consumeLeadQuickCreateDraft, isLeadQuickCreateHandoff } from "@/components/leads/leadQuickCreateDraft";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/ui/PageShell";
import { RouteErrorState, RouteLoadingState } from "@/components/ui/RouteStates";
import { useResolvedRecordLayout } from "@/hooks/useResolvedRecordLayout";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { useCloneDraft } from "@/hooks/useCloneDraft";
import { formValuesFromCopy } from "@/lib/formValues";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";

/** Field ids on the full form: the long-standing ones, so focus, errors and specs still find them. */
const leadFullFormInputId = (fieldKey: string) => LEAD_FORM_INPUT_IDS[fieldKey] ?? `lead-${fieldKey.replace(/_/g, "-")}`;

type LeadSummary = {
  lead: LeadFormValue & {
    lead_id: number;
    custom_fields?: Record<string, unknown> | null;
    updated_at?: string | null;
  };
};

async function fetchLeadSummary(leadId: string) {
  const res = await apiFetch(`/sales/leads/${leadId}/summary`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
  return body as LeadSummary;
}

export default function LeadRecordFormPage({ mode, leadId }: { mode: "create" | "edit"; leadId?: string }) {
  const router = useRouter();
  // R2 travels in both directions: the tab the operator left is on this page's own URL,
  // so Back, Cancel and the post-save redirect all return to it.
  const listHref = "/dashboard/sales/leads";
  const cancelHref = useRecordTabHref(mode === "edit" && leadId ? `${listHref}/${leadId}` : listHref);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<LeadFormValue>(EMPTY_LEAD_FORM);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});
  const [initialSnapshot, setInitialSnapshot] = useState(() => JSON.stringify([EMPTY_LEAD_FORM, {}]));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const serverErrors = useServerFormErrors(leadFormInputIdFor);
  const [submitting, setSubmitting] = useState(false);
  // The `full_form` layout (13b Phase 4e); the body below reads the same cached query.
  const layoutQuery = useResolvedRecordLayout("sales_leads", "full_form");
  const { fields: moduleFields } = useModuleFieldConfigs("sales_leads");
  const summaryQuery = useQuery({
    queryKey: ["sales-lead-summary", leadId],
    queryFn: () => fetchLeadSummary(leadId as string),
    enabled: mode === "edit" && Boolean(leadId),
    refetchOnWindowFocus: false,
  });
  // *Clone* (13b Phase 5): `?clone=<id>` fills this create form from that lead. The copy is
  // the starting point, so leaving it untouched is not unsaved work.
  const clone = useCloneDraft("sales_leads", mode === "create");
  useEffect(() => {
    if (!clone.draft) return;
    const nextForm = formValuesFromCopy(EMPTY_LEAD_FORM, clone.draft.fields);
    setForm(nextForm);
    setCustomFieldValues(clone.draft.custom_fields);
    setInitialSnapshot(JSON.stringify([nextForm, clone.draft.custom_fields]));
  }, [clone.draft]);

  // Picks up values handed off from Quick Create's "More details". The initial snapshot stays
  // empty on purpose, so the restored values count as unsaved changes and stay guarded.
  useEffect(() => {
    if (mode !== "create" || !isLeadQuickCreateHandoff(window.location.search)) return;
    const draft = consumeLeadQuickCreateDraft();
    if (!draft) return;
    setForm(draft.form);
    setCustomFieldValues(draft.customFieldValues);
  }, [mode]);

  useEffect(() => {
    if (mode !== "edit" || !summaryQuery.data) return;
    const lead = summaryQuery.data.lead;
    const nextForm: LeadFormValue = {
      first_name: lead.first_name ?? "",
      last_name: lead.last_name ?? "",
      company: lead.company ?? "",
      primary_email: lead.primary_email ?? "",
      phone: lead.phone ?? "",
      mobile_phone: lead.mobile_phone ?? "",
      title: lead.title ?? "",
      source: lead.source ?? "",
      status: lead.status ?? "new",
      notes: lead.notes ?? "",
      assigned_to: lead.assigned_to ?? null,
      assigned_to_name: lead.assigned_to_name ?? "",
      next_follow_up_at: toDatetimeLocalValue(lead.next_follow_up_at),
      team_id: lead.team_id ?? null,
      team_name: lead.team_name ?? "",
      tags: Array.isArray(lead.tags) ? lead.tags : [],
    };
    const nextCustomFields = lead.custom_fields ?? {};
    setForm(nextForm);
    setCustomFieldValues(nextCustomFields);
    setInitialSnapshot(JSON.stringify([nextForm, nextCustomFields]));
  }, [mode, summaryQuery.data]);

  const currentSnapshot = useMemo(() => JSON.stringify([form, customFieldValues]), [form, customFieldValues]);
  const isDirty = currentSnapshot !== initialSnapshot;

  useUnsavedChangesGuard(isDirty, submitting);

  useLeadStatusDefault(
    form.status,
    useCallback((status: string) => setForm((current) => (current.status ? current : { ...current, status })), []),
  );

  function validate() {
    const nextErrors = layoutQuery.data ? validateLayoutDrivenQuickCreate(layoutQuery.data, form, customFieldValues) : {};
    const emailError = nextErrors.primary_email ? null : validateLeadEmail(form);
    if (emailError) nextErrors.primary_email = emailError;
    setFieldErrors(nextErrors);
    const firstInvalid = Object.keys(nextErrors)[0];
    if (firstInvalid) {
      const id = firstInvalid.startsWith("custom:")
        ? `custom-field-sales_leads-${firstInvalid.slice("custom:".length)}`
        : leadFullFormInputId(firstInvalid);
      document.getElementById(id)?.focus();
      return false;
    }
    return true;
  }

  async function submit() {
    if (!validate()) return;
    try {
      setSubmitting(true);
      serverErrors.clear();
      const savedLeadId = await saveLead({
        mode,
        leadId,
        payload: buildLeadPayload(form, customFieldValues, moduleFields),
      });
      await queryClient.invalidateQueries({ queryKey: ["sales-leads"] });
      if (savedLeadId) await queryClient.invalidateQueries({ queryKey: ["sales-lead-summary", String(savedLeadId)] });
      setInitialSnapshot(currentSnapshot);
      toast.success(mode === "edit" ? "Lead updated." : "Lead created.");
      router.push(mode === "edit" ? cancelHref : (savedLeadId ? `${listHref}/${savedLeadId}` : listHref));
    } catch (error) {
      serverErrors.report(error, mode === "edit" ? "The lead could not be updated. Check the fields and try again." : "The lead could not be created. Check the fields and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (clone.isLoading) return <RouteLoadingState label="lead" />;
  if (clone.error) {
    return <RouteErrorState title="This lead could not be copied" reset={() => void clone.refetch()} backHref="/dashboard/sales/leads" backLabel="Back to leads" />;
  }
  if (mode === "edit" && summaryQuery.isLoading) {
    return <RouteLoadingState label="lead" />;
  }

  if (mode === "edit" && summaryQuery.error) {
    return <RouteErrorState title="This lead could not be loaded" reset={() => void summaryQuery.refetch()} backHref="/dashboard/sales/leads" backLabel="Back to leads" />;
  }

  const title = mode === "edit" ? "Edit lead" : "Create lead";
  // Archetype 3's visible heading: the record's name on an edit, the noun on a create.
  const lead = summaryQuery.data?.lead;
  const recordName =
    [lead?.first_name, lead?.last_name].filter(Boolean).join(" ").trim() || lead?.company || "Lead";

  return (
    <PageShell
      title={title}
      eyebrow={mode === "edit" && summaryQuery.data?.lead.updated_at ? `Last modified ${formatDateTime(summaryQuery.data.lead.updated_at)}` : undefined}
      description={mode === "edit" ? "Update lead details and qualification information." : "Capture a new prospect and prepare the first follow-up."}
      actions={(
        <Button asChild variant="ghost" size="sm">
          <Link href={cancelHref}><ArrowLeft />Back to {mode === "edit" ? "lead" : "leads"}</Link>
        </Button>
      )}
    >
      {serverErrors.message ? (
        <FormErrorBanner title="We could not save this lead.">{serverErrors.message}</FormErrorBanner>
      ) : null}

      <ServerFieldErrorsProvider errors={serverErrors.errors} inputIdFor={leadFormInputIdFor}>
      <RecordFormLayout
        title={mode === "edit" ? recordName : "Create lead"}
        status={isDirty ? "Unsaved changes" : mode === "edit" ? null : "Complete the required fields to create this lead."}
        actions={(
          <>
            <Button asChild variant="outline"><Link href={cancelHref}>Cancel</Link></Button>
            <Button onClick={() => void submit()} disabled={submitting || (mode === "edit" && !isDirty)}>
              <Save />{submitting ? "Saving…" : mode === "edit" ? "Save changes" : "Create lead"}
            </Button>
          </>
        )}
      >
        <LayoutRecordFormBody<LeadFormValue>
          moduleKey="sales_leads"
          value={form}
          onChange={setForm}
          customValues={customFieldValues}
          onCustomChange={(fieldKey, value) => setCustomFieldValues((current) => ({ ...current, [fieldKey]: value }))}
          inputId={leadFullFormInputId}
          action={mode}
          errors={fieldErrors}
        />
      </RecordFormLayout>
      </ServerFieldErrorsProvider>
    </PageShell>
  );
}
