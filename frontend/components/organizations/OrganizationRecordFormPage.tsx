"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";

import {
  OrganizationFormMainFields,
  OrganizationFormSidebarFields,
  EMPTY_ORGANIZATION_FORM,
  type OrganizationFormValue,
} from "@/components/organizations/OrganizationFormFields";
import { RecordFormLayout } from "@/components/forms/RecordFormLayout";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  RouteErrorState,
  RouteLoadingState,
} from "@/components/ui/RouteStates";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import {
  pickEnabledModulePayload,
  useModuleFieldConfigs,
} from "@/hooks/useModuleFieldConfigs";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
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

export default function OrganizationRecordFormPage({
  mode,
  orgId,
}: {
  mode: "create" | "edit";
  orgId?: string;
}) {
  const router = useRouter();
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
  const [nameError, setNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const customFieldsQuery = useModuleCustomFields("sales_organizations", true);
  const { fields: moduleFields } = useModuleFieldConfigs("sales_organizations");
  const summaryQuery = useQuery({
    queryKey: ["sales-organization-summary", orgId],
    queryFn: () => fetchOrganizationSummary(orgId as string),
    enabled: mode === "edit" && Boolean(orgId),
    refetchOnWindowFocus: false,
  });

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
      annual_revenue: organization.annual_revenue ?? "",
      billing_address: organization.billing_address ?? "",
      billing_city: organization.billing_city ?? "",
      billing_state: organization.billing_state ?? "",
      billing_postal_code: organization.billing_postal_code ?? "",
      billing_country: organization.billing_country ?? "",
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
    const name = form.org_name.trim();
    const email = form.primary_email.trim();
    setNameError(name ? null : "Account name is required.");
    setEmailError(
      !email
        ? "Primary email is required."
        : /^\S+@\S+\.\S+$/.test(email)
          ? null
          : "Enter a valid email address.",
    );
    if (!name) {
      document.getElementById("account-name")?.focus();
      return false;
    }
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      document.getElementById("account-primary-email")?.focus();
      return false;
    }
    return true;
  }

  async function submit() {
    if (!validate()) return;
    try {
      setSubmitting(true);
      setSubmitError(null);
      const payload = pickEnabledModulePayload(
        {
          ...Object.fromEntries(
            Object.entries(form)
              .filter(([key]) => !["assigned_to_name"].includes(key))
              .map(([key, value]) => [
                key,
                typeof value === "string" ? value.trim() || null : value,
              ]),
          ),
          assigned_to:
            mode === "edit" && form.assigned_to === null
              ? undefined
              : form.assigned_to,
          custom_fields: customFieldValues,
        },
        moduleFields,
        ["org_name", "primary_email", "custom_fields"],
      );
      const endpoint =
        mode === "edit"
          ? `/sales/organizations/${orgId}`
          : "/sales/organizations";
      const res = await apiFetch(endpoint, {
        method: mode === "edit" ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => null)) as {
        org_id?: number;
        detail?: string;
      } | null;
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      const savedOrgId = mode === "edit" ? orgId : body?.org_id;
      await queryClient.invalidateQueries({
        queryKey: ["sales-organizations"],
      });
      if (savedOrgId)
        await queryClient.invalidateQueries({
          queryKey: ["sales-organization-summary", String(savedOrgId)],
        });
      setInitialSnapshot(currentSnapshot);
      toast.success(mode === "edit" ? "Account updated." : "Account created.");
      router.push(
        savedOrgId
          ? `/dashboard/sales/organizations/${savedOrgId}`
          : "/dashboard/sales/organizations",
      );
    } catch {
      setSubmitError(
        mode === "edit"
          ? "The account could not be updated. Check the fields and try again."
          : "The account could not be created. Check the fields and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (mode === "edit" && summaryQuery.isLoading)
    return <RouteLoadingState label="account" />;
  if (mode === "edit" && summaryQuery.error)
    return (
      <RouteErrorState
        title="Unable to load this account"
        reset={() => void summaryQuery.refetch()}
        backHref="/dashboard/sales/organizations"
        backLabel="Back to accounts"
      />
    );
  const title = mode === "edit" ? "Edit account" : "Create account";
  const cancelHref =
    mode === "edit" && orgId
      ? `/dashboard/sales/organizations/${orgId}`
      : "/dashboard/sales/organizations";
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
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
      />
      {submitError ? (
        <div
          role="alert"
          className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary"
        >
          <div className="font-medium">We could not save this account.</div>
          <div className="mt-1 text-copy-secondary">{submitError}</div>
        </div>
      ) : null}
      <RecordFormLayout
        sidebar={
          <OrganizationFormSidebarFields
            value={form}
            onChange={setForm}
            moduleFields={moduleFields}
            mode={mode}
          />
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-copy-muted">
              {isDirty
                ? "You have unsaved changes."
                : mode === "edit"
                  ? "No unsaved changes."
                  : "Complete the required fields to create this account."}
            </span>
            <div className="flex items-center gap-2">
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
            </div>
          </div>
        }
      >
        <OrganizationFormMainFields
          value={form}
          onChange={setForm}
          customFields={customFieldsQuery.data ?? []}
          customFieldValues={customFieldValues}
          onCustomFieldChange={(fieldKey, value) =>
            setCustomFieldValues((current) => ({
              ...current,
              [fieldKey]: value,
            }))
          }
          moduleFields={moduleFields}
          nameError={nameError}
          emailError={emailError}
          mode={mode}
        />
      </RecordFormLayout>
    </div>
  );
}
