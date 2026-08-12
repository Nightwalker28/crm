"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";

import { RecordFormLayout } from "@/components/forms/RecordFormLayout";
import {
  EMPTY_OPPORTUNITY_FORM,
  OpportunityFormMainFields,
  OpportunityFormSidebarFields,
  type OpportunityFormValue,
} from "@/components/opportunities/OpportunityFormFields";
import {
  buildOpportunityPayload,
  saveOpportunity,
  validateOpportunityContact,
  validateOpportunityName,
} from "@/components/opportunities/opportunityMutation";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  RouteErrorState,
  RouteLoadingState,
} from "@/components/ui/RouteStates";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";

type OpportunitySummary = {
  opportunity: OpportunityFormValue & {
    opportunity_id: number;
    custom_fields?: Record<string, unknown> | null;
    updated_at?: string | null;
  };
  contact?: {
    first_name?: string | null;
    last_name?: string | null;
    primary_email?: string | null;
  } | null;
  organization?: { org_name: string } | null;
};
async function fetchSummary(id: string) {
  const res = await apiFetch(`/sales/opportunities/${id}/summary`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
  return body as OpportunitySummary;
}

export default function OpportunityRecordFormPage({
  mode,
  opportunityId,
}: {
  mode: "create" | "edit";
  opportunityId?: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<OpportunityFormValue>(
    EMPTY_OPPORTUNITY_FORM,
  );
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});
  const [initialSnapshot, setInitialSnapshot] = useState(() =>
    JSON.stringify([EMPTY_OPPORTUNITY_FORM, {}]),
  );
  const [nameError, setNameError] = useState<string | null>(null);
  const [contactError, setContactError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const customFields = useModuleCustomFields("sales_opportunities", true);
  const { fields: moduleFields } = useModuleFieldConfigs("sales_opportunities");
  const summaryQuery = useQuery({
    queryKey: ["sales-opportunity-summary", opportunityId],
    queryFn: () => fetchSummary(opportunityId as string),
    enabled: mode === "edit" && Boolean(opportunityId),
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (mode !== "edit" || !summaryQuery.data) return;
    const opportunity = summaryQuery.data.opportunity;
    const contactName =
      opportunity.contact_name ||
      [
        summaryQuery.data.contact?.first_name,
        summaryQuery.data.contact?.last_name,
      ]
        .filter(Boolean)
        .join(" ") ||
      summaryQuery.data.contact?.primary_email ||
      opportunity.client ||
      "";
    const next: OpportunityFormValue = {
      ...EMPTY_OPPORTUNITY_FORM,
      ...opportunity,
      contact_name: contactName,
      organization_name:
        opportunity.organization_name ||
        summaryQuery.data.organization?.org_name ||
        "",
      assigned_to_name: opportunity.assigned_to_name || "",
      probability_percent: opportunity.probability_percent?.toString() ?? "",
      start_date: opportunity.start_date ?? "",
      expected_close_date: opportunity.expected_close_date ?? "",
      attachments: opportunity.attachments ?? [],
    };
    const values = opportunity.custom_fields ?? {};
    setForm(next);
    setCustomValues(values);
    setInitialSnapshot(JSON.stringify([next, values]));
  }, [mode, summaryQuery.data]);
  const snapshot = useMemo(
    () => JSON.stringify([form, customValues]),
    [form, customValues],
  );
  const dirty = snapshot !== initialSnapshot;
  useUnsavedChangesGuard(dirty, submitting);
  function validate() {
    const nextNameError = validateOpportunityName(form.opportunity_name);
    const nextContactError = validateOpportunityContact(form.contact_id);
    setNameError(nextNameError);
    setContactError(nextContactError);
    if (nextNameError) document.getElementById("deal-name")?.focus();
    return !nextNameError && !nextContactError;
  }
  async function submit() {
    if (!validate()) return;
    try {
      setSubmitting(true);
      setSubmitError(null);
      const savedId = await saveOpportunity({
        mode,
        opportunityId,
        payload: buildOpportunityPayload(form, customValues, moduleFields, mode),
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-opportunities"] }),
        queryClient.invalidateQueries({
          queryKey: ["sales-opportunities-pipeline-summary"],
        }),
      ]);
      setInitialSnapshot(snapshot);
      toast.success(mode === "edit" ? "Deal updated." : "Deal created.");
      router.push(
        savedId
          ? `/dashboard/sales/opportunities/${savedId}`
          : "/dashboard/sales/opportunities",
      );
    } catch {
      setSubmitError(
        mode === "edit"
          ? "The deal could not be updated. Check the fields and try again."
          : "The deal could not be created. Check the fields and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }
  if (mode === "edit" && summaryQuery.isLoading)
    return <RouteLoadingState label="deal" />;
  if (mode === "edit" && summaryQuery.error)
    return (
      <RouteErrorState
        title="Unable to load this deal"
        reset={() => void summaryQuery.refetch()}
        backHref="/dashboard/sales/opportunities"
        backLabel="Back to deals"
      />
    );
  const cancelHref =
    mode === "edit" && opportunityId
      ? `/dashboard/sales/opportunities/${opportunityId}`
      : "/dashboard/sales/opportunities";
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={mode === "edit" ? "Edit deal" : "Create deal"}
        eyebrow={
          mode === "edit" && summaryQuery.data?.opportunity.updated_at
            ? `Last modified ${formatDateTime(summaryQuery.data.opportunity.updated_at)}`
            : undefined
        }
        description={
          mode === "edit"
            ? "Update pipeline, value, linked customers, and delivery context."
            : "Add a qualified commercial opportunity to the pipeline."
        }
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href={cancelHref}>
              <ArrowLeft />
              Back to {mode === "edit" ? "deal" : "deals"}
            </Link>
          </Button>
        }
      />
      {submitError ? (
        <div
          role="alert"
          className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary"
        >
          <div className="font-medium">We could not save this deal.</div>
          <div className="mt-1 text-copy-secondary">{submitError}</div>
        </div>
      ) : null}
      <RecordFormLayout
        sidebar={
          <OpportunityFormSidebarFields
            value={form}
            onChange={setForm}
            moduleFields={moduleFields}
            mode={mode}
          />
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-copy-muted">
              {dirty
                ? "You have unsaved changes."
                : mode === "edit"
                  ? "No unsaved changes."
                  : "Complete the required fields to create this deal."}
            </span>
            <div className="flex items-center gap-2">
              <Button asChild variant="outline">
                <Link href={cancelHref}>Cancel</Link>
              </Button>
              <Button
                onClick={() => void submit()}
                disabled={submitting || (mode === "edit" && !dirty)}
              >
                <Save />
                {submitting
                  ? "Saving…"
                  : mode === "edit"
                    ? "Save changes"
                    : "Create deal"}
              </Button>
            </div>
          </div>
        }
      >
        <OpportunityFormMainFields
          value={form}
          onChange={setForm}
          customFields={customFields.data ?? []}
          customFieldValues={customValues}
          onCustomFieldChange={(key, value) =>
            setCustomValues((current) => ({ ...current, [key]: value }))
          }
          moduleFields={moduleFields}
          nameError={nameError}
          contactError={contactError}
          mode={mode}
        />
      </RecordFormLayout>
    </div>
  );
}
