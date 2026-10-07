"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";

import {
  EMPTY_ORGANIZATION_FORM,
  ORGANIZATION_FORM_INPUT_IDS,
  organizationFormInputIdFor,
  type OrganizationFormValue,
} from "@/components/organizations/OrganizationFormFields";
import { LayoutRecordFormBody } from "@/components/forms/LayoutRecordFormBody";
import { validateLayoutDrivenQuickCreate } from "@/components/forms/quickCreateLayout";
import { useResolvedRecordLayout } from "@/hooks/useResolvedRecordLayout";
import {
  buildOrganizationPayload,
  saveOrganization,
  validateOrganizationEmail,
  validateOrganizationName,
} from "@/components/organizations/organizationMutation";
import {
  consumeOrganizationQuickCreateDraft,
  isOrganizationQuickCreateHandoff,
} from "@/components/organizations/organizationQuickCreateDraft";
import { FormErrorBanner } from "@/components/forms/FormErrorBanner";
import { addressFrom, flatAddress, type AddressPart } from "@/components/forms/AddressFields";
import { ServerFieldErrorsProvider, useServerFormErrors } from "@/components/forms/ServerFieldErrors";
import { RecordFormLayout } from "@/components/forms/RecordFormLayout";
import { useRecordTabHref } from "@/components/recordWorkspace/RecordWorkspace";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/ui/PageShell";
import {
  RouteErrorState,
  RouteLoadingState,
} from "@/components/ui/RouteStates";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { useCloneDraft } from "@/hooks/useCloneDraft";
import { formValuesFromCopy } from "@/lib/formValues";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";

type OrganizationSummary = {
  organization: OrganizationFormValue & {
    org_id: number;
    custom_fields?: Record<string, unknown> | null;
    updated_at?: string | null;
  };
};

async function fetchOrganizationSummary(orgId: string) {
  const res = await apiFetch(`/sales/organizations/${orgId}/summary`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
  return body as OrganizationSummary;
}


/** Field ids on the full form: the long-standing ones, so focus, errors and specs still find them. */
const organizationFullFormInputId = (fieldKey: string) =>
  ORGANIZATION_FORM_INPUT_IDS[fieldKey] ?? `account-${fieldKey.replace(/_/g, "-")}`;

export default function OrganizationRecordFormPage({
  mode,
  orgId,
}: {
  mode: "create" | "edit";
  orgId?: string;
}) {
  const router = useRouter();
  // R2 travels in both directions: the tab the operator left is on this page's own URL,
  // so Back, Cancel and the post-save redirect all return to it.
  const listHref = "/dashboard/sales/organizations";
  const cancelHref = useRecordTabHref(mode === "edit" && orgId ? `${listHref}/${orgId}` : listHref);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<OrganizationFormValue>(
    EMPTY_ORGANIZATION_FORM,
  );
  const [customFieldValues, setCustomFieldValues] = useState<
    Record<string, unknown>
  >({});
  const [initialSnapshot, setInitialSnapshot] = useState(() =>
    JSON.stringify([EMPTY_ORGANIZATION_FORM, {}]),
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const serverErrors = useServerFormErrors(organizationFormInputIdFor);
  const [submitting, setSubmitting] = useState(false);
  // The `full_form` layout (13b Phase 4e); the body below reads the same cached query.
  const layoutQuery = useResolvedRecordLayout("sales_organizations", "full_form");
  const { fields: moduleFields } = useModuleFieldConfigs("sales_organizations");
  const summaryQuery = useQuery({
    queryKey: ["sales-organization-summary", orgId],
    queryFn: () => fetchOrganizationSummary(orgId as string),
    enabled: mode === "edit" && Boolean(orgId),
    refetchOnWindowFocus: false,
  });
  // *Clone* (13b Phase 5): `?clone=<id>` fills this create form from that account. The copy is
  // the starting point, so leaving it untouched is not unsaved work.
  const clone = useCloneDraft("sales_organizations", mode === "create");
  useEffect(() => {
    if (!clone.draft) return;
    const nextForm = formValuesFromCopy(EMPTY_ORGANIZATION_FORM, clone.draft.fields);
    setForm(nextForm);
    setCustomFieldValues(clone.draft.custom_fields);
    setInitialSnapshot(JSON.stringify([nextForm, clone.draft.custom_fields]));
  }, [clone.draft]);

  // Picks up values handed off from Quick Create's "More details". The initial snapshot stays
  // empty on purpose, so the restored values count as unsaved changes and stay guarded.
  useEffect(() => {
    if (mode !== "create" || !isOrganizationQuickCreateHandoff(window.location.search)) return;
    const draft = consumeOrganizationQuickCreateDraft();
    if (!draft) return;
    setForm(draft.form);
    setCustomFieldValues(draft.customFieldValues);
  }, [mode]);

  useEffect(() => {
    if (mode !== "edit" || !summaryQuery.data) return;
    const organization = summaryQuery.data.organization;
    const nextForm: OrganizationFormValue = {
      org_name: organization.org_name ?? "",
      primary_email: organization.primary_email ?? "",
      secondary_email: organization.secondary_email ?? "",
      website: organization.website ?? "",
      primary_phone: organization.primary_phone ?? "",
      secondary_phone: organization.secondary_phone ?? "",
      industry: organization.industry ?? "",
      account_type: organization.account_type ?? "",
      annual_revenue: organization.annual_revenue != null ? String(organization.annual_revenue) : "",
      employee_count: organization.employee_count != null ? String(organization.employee_count) : "",
      ...(flatAddress("billing", addressFrom(organization as unknown as Record<string, unknown>, "billing")) as Pick<OrganizationFormValue, `billing_${AddressPart}`>),
      ...(flatAddress("shipping", addressFrom(organization as unknown as Record<string, unknown>, "shipping")) as Pick<OrganizationFormValue, `shipping_${AddressPart}`>),
      is_vendor: Boolean(organization.is_vendor),
      payment_terms_days: organization.payment_terms_days != null ? String(organization.payment_terms_days) : "",
      assigned_to: organization.assigned_to ?? null,
      assigned_to_name: organization.assigned_to_name ?? "",
    };
    const nextCustomFields = organization.custom_fields ?? {};
    setForm(nextForm);
    setCustomFieldValues(nextCustomFields);
    setInitialSnapshot(JSON.stringify([nextForm, nextCustomFields]));
  }, [mode, summaryQuery.data]);

  const currentSnapshot = useMemo(
    () => JSON.stringify([form, customFieldValues]),
    [form, customFieldValues],
  );
  const isDirty = currentSnapshot !== initialSnapshot;
  useUnsavedChangesGuard(isDirty, submitting);

  function validate() {
    const nextErrors = layoutQuery.data ? validateLayoutDrivenQuickCreate(layoutQuery.data, form, customFieldValues) : {};
    const nameError = nextErrors.org_name ? null : validateOrganizationName(form.org_name);
    if (nameError) nextErrors.org_name = nameError;
    const emailError = nextErrors.primary_email ? null : validateOrganizationEmail(form.primary_email);
    if (emailError) nextErrors.primary_email = emailError;
    setFieldErrors(nextErrors);
    const firstInvalid = Object.keys(nextErrors)[0];
    if (firstInvalid) {
      const id = firstInvalid.startsWith("custom:")
        ? `custom-field-sales_organizations-${firstInvalid.slice("custom:".length)}`
        : organizationFullFormInputId(firstInvalid);
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
      const savedOrgId = await saveOrganization({
        mode,
        organizationId: orgId,
        payload: buildOrganizationPayload(form, customFieldValues, moduleFields, mode),
      });
      await queryClient.invalidateQueries({
        queryKey: ["sales-organizations"],
      });
      if (savedOrgId)
        await queryClient.invalidateQueries({
          queryKey: ["sales-organization-summary", String(savedOrgId)],
        });
      setInitialSnapshot(currentSnapshot);
      toast.success(mode === "edit" ? "Account updated." : "Account created.");
      router.push(mode === "edit" ? cancelHref : (savedOrgId ? `${listHref}/${savedOrgId}` : listHref));
    } catch (error) {
      serverErrors.report(error, 
        mode === "edit"
          ? "The account could not be updated. Check the fields and try again."
          : "The account could not be created. Check the fields and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (clone.isLoading) return <RouteLoadingState label="account" />;
  if (clone.error) {
    return <RouteErrorState title="This account could not be copied" reset={() => void clone.refetch()} backHref="/dashboard/sales/organizations" backLabel="Back to accounts" />;
  }
  if (mode === "edit" && summaryQuery.isLoading)
    return <RouteLoadingState label="account" />;
  if (mode === "edit" && summaryQuery.error)
    return (
      <RouteErrorState
        title="This account could not be loaded"
        reset={() => void summaryQuery.refetch()}
        backHref="/dashboard/sales/organizations"
        backLabel="Back to accounts"
      />
    );
  const title = mode === "edit" ? "Edit account" : "Create account";
  return (
    <PageShell
      title={title}
      eyebrow={
        mode === "edit" && summaryQuery.data?.organization.updated_at
          ? `Last modified ${formatDateTime(summaryQuery.data.organization.updated_at)}`
          : undefined
      }
      description={
        mode === "edit"
          ? "Update account, billing, and ownership information."
          : "Create a company account for contacts, deals, and transactions."
      }
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link href={cancelHref}>
            <ArrowLeft />
            Back to {mode === "edit" ? "account" : "accounts"}
          </Link>
        </Button>
      }
    >
      {serverErrors.message ? (
        <FormErrorBanner title="We could not save this account.">{serverErrors.message}</FormErrorBanner>
      ) : null}
      <ServerFieldErrorsProvider errors={serverErrors.errors} inputIdFor={organizationFormInputIdFor}>
      <RecordFormLayout
        title={mode === "edit" ? (form.org_name.trim() || "Account") : "Create account"}
        status={isDirty
          ? "Unsaved changes"
          : mode === "edit"
          ? null
          : "Complete the required fields to create this account."}
        actions={(
          <>
            <Button asChild variant="outline">
              <Link href={cancelHref}>Cancel</Link>
            </Button>
            <Button
              onClick={() => void submit()}
              disabled={submitting || (mode === "edit" && !isDirty)}
            >
              <Save />
              {submitting
                ? "Saving…"
                : mode === "edit"
                  ? "Save changes"
                  : "Create account"}
            </Button>
          </>
        )}
      >
        <LayoutRecordFormBody<OrganizationFormValue>
          moduleKey="sales_organizations"
          value={form}
          onChange={setForm}
          customValues={customFieldValues}
          onCustomChange={(fieldKey, value) => setCustomFieldValues((current) => ({ ...current, [fieldKey]: value }))}
          inputId={organizationFullFormInputId}
          action={mode}
          errors={fieldErrors}
        />
      </RecordFormLayout>
      </ServerFieldErrorsProvider>
    </PageShell>
  );
}
