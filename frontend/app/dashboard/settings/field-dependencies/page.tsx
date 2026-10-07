"use client";

import { useMemo, useState } from "react";
import { GitBranch, Plus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { FormSection } from "@/components/forms/RecordFormLayout";
import { MultiOptionSelect } from "@/components/picklists/MultiOptionSelect";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { PageShell } from "@/components/ui/PageShell";
import { RecordTable } from "@/components/ui/RecordTable";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useConfirm } from "@/hooks/useConfirm";
import {
  adminDependenciesQueryKey,
  deleteDependency,
  picklistErrorMessage,
  saveDependency,
  useAdminPicklistDependencies,
  type DependencyField,
} from "@/hooks/usePicklistAdmin";
import { picklistDependenciesQueryKey, type PicklistDependency } from "@/hooks/usePicklistDependencies";
import { usePicklists } from "@/hooks/usePicklists";
import { isForbiddenError } from "@/lib/api";
import { SETTINGS_ROUTES } from "@/lib/routes";

// Every module whose saves check dependencies (13b Phase 4 slices 4b and 4c): the CRM, sales
// orders, products and services, and the ERP documents — the modules that take custom fields.
const MODULES = [
  { key: "sales_leads", label: "Leads" },
  { key: "sales_contacts", label: "Contacts" },
  { key: "sales_organizations", label: "Accounts" },
  { key: "sales_opportunities", label: "Deals" },
  { key: "sales_quotes", label: "Quotes" },
  { key: "sales_orders", label: "Orders" },
  { key: "catalog_products", label: "Products" },
  { key: "catalog_services", label: "Services" },
  { key: "finance_pos", label: "Invoices" },
  { key: "finance_credit_notes", label: "Credit notes" },
  { key: "finance_payments", label: "Payments" },
  { key: "purchase_orders", label: "Purchase orders" },
  { key: "purchase_receipts", label: "Receipts" },
  { key: "purchase_bills", label: "Bills" },
  { key: "inventory_deliveries", label: "Deliveries" },
  { key: "inventory_returns", label: "Returns" },
  { key: "inventory_adjustments", label: "Stock adjustments" },
  { key: "inventory_transfers", label: "Stock transfers" },
] as const;

type ModuleKey = (typeof MODULES)[number]["key"];

type Draft = {
  /** The dependent field being edited; empty while a new one is chosen. */
  dependent: string;
  controlling: string;
  valueMap: Record<string, string[]>;
  isNew: boolean;
};

const EMPTY_DRAFT: Draft = { dependent: "", controlling: "", valueMap: {}, isNew: true };

/**
 * Settings → Field dependencies (13b §3.6, F3.6): one picklist field limits another's values
 * on the same module, the way Salesforce's field dependencies and Zoho's picklist dependency
 * work. Each value of the controlling field lists the dependent values it allows; a value
 * that lists none leaves the dependent field empty. Country → state is built in.
 */
export default function FieldDependenciesSettingsPage() {
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const { byKey: lists } = usePicklists();
  const [moduleKey, setModuleKey] = useState<ModuleKey>("sales_opportunities");
  const query = useAdminPicklistDependencies(moduleKey);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fields = useMemo(() => new Map((query.data?.fields ?? []).map((field) => [field.field_key, field])), [query.data]);
  const fieldLabel = (fieldKey: string) => fields.get(fieldKey)?.label ?? fieldKey;
  const usedAsDependent = new Set((query.data?.results ?? []).map((item) => item.dependent_field_key));

  const controllingField = draft ? fields.get(draft.controlling) : undefined;
  const dependentField = draft ? fields.get(draft.dependent) : undefined;
  const controllingValues = (controllingField && lists.get(controllingField.list_key)?.values.filter((value) => value.is_active)) || [];
  const dependentOptions = (dependentField && lists.get(dependentField.list_key)?.values.filter((value) => value.is_active).map((value) => ({ value: value.key, label: value.label }))) || [];

  const fieldOptions = (predicate: (field: DependencyField) => boolean) => [
    ...(query.data?.fields ?? []).filter(predicate).map((field) => ({ value: field.field_key, label: field.label })),
  ];

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: adminDependenciesQueryKey(moduleKey) }),
      queryClient.invalidateQueries({ queryKey: picklistDependenciesQueryKey(moduleKey) }),
    ]);
  }

  function edit(dependency: PicklistDependency) {
    setError(null);
    setDraft({
      dependent: dependency.dependent_field_key,
      controlling: dependency.controlling_field_key,
      valueMap: dependency.value_map,
      isNew: false,
    });
  }

  async function save() {
    if (!draft?.dependent || !draft.controlling) {
      setError("Choose both fields.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveDependency(moduleKey, draft.dependent, { controlling_field_key: draft.controlling, value_map: draft.valueMap });
      await refresh();
      toast.success(`${fieldLabel(draft.controlling)} now controls ${fieldLabel(draft.dependent)}.`);
      setDraft(null);
    } catch (caught) {
      setError(picklistErrorMessage(caught, "The dependency could not be saved. Try again."));
    } finally {
      setSaving(false);
    }
  }

  async function remove(dependency: PicklistDependency) {
    const confirmed = await confirm({
      title: "Remove this dependency?",
      description: `${fieldLabel(dependency.dependent_field_key)} will offer all its values again, whatever ${fieldLabel(dependency.controlling_field_key)} holds.`,
      confirmLabel: "Remove dependency",
    });
    if (!confirmed) return;
    try {
      await deleteDependency(moduleKey, dependency.dependent_field_key);
      await refresh();
      if (draft?.dependent === dependency.dependent_field_key) setDraft(null);
      toast.success("Dependency removed.");
    } catch (caught) {
      toast.error(picklistErrorMessage(caught, "The dependency could not be removed. Try again."));
    }
  }

  const isForbidden = isForbiddenError(query.error);

  return (
    <PageShell
      variant="settings"
      title="Field dependencies"
      description="Let one picklist limit another's values. Forms offer only the allowed values, and saves outside them are refused."
      backHref={SETTINGS_ROUTES.root}
      backLabel="Back to settings"
    >
      <Field className="max-w-xs">
        <FieldLabel htmlFor="dependency-module">Module</FieldLabel>
        <SearchableSelect
          id="dependency-module"
          label="Module"
          value={moduleKey}
          options={MODULES.map((module) => ({ value: module.key, label: module.label }))}
          onValueChange={(next) => {
            setModuleKey(next as ModuleKey);
            setDraft(null);
            setError(null);
          }}
        />
      </Field>

      <RecordTable
        label="Field dependencies"
        columns={[
          {
            key: "controlling",
            label: "Controlling field",
            render: (item) => <span className="font-medium text-copy-primary">{fieldLabel(item.controlling_field_key)}</span>,
          },
          { key: "dependent", label: "Dependent field", render: (item) => fieldLabel(item.dependent_field_key) },
          {
            key: "mapped",
            label: "Values mapped",
            size: "sm",
            align: "right",
            render: (item) => <span className="tabular-nums">{Object.values(item.value_map).filter((values) => values.length).length}</span>,
          },
        ]}
        rows={query.data?.results ?? []}
        rowKey={(item) => item.id}
        onOpenRow={edit}
        rowLabel={(item) => `Edit ${fieldLabel(item.dependent_field_key)}`}
        rowActions={(item) => (
          <Button type="button" variant="ghost" size="sm" onClick={() => void remove(item)}>
            Remove
          </Button>
        )}
        rowActionsLabel="Actions"
        isLoading={query.isLoading}
        isRefreshing={query.isFetching && !query.isLoading}
        isPermissionDenied={isForbidden}
        hasError={Boolean(query.error) && !isForbidden}
        onRetry={() => void query.refetch()}
        errorState={{ title: "Field dependencies could not be loaded" }}
        emptyState={{
          icon: GitBranch,
          title: "No dependencies yet",
          description: "Every picklist on this module offers all its values.",
          action: (
            <Button type="button" variant="outline" onClick={() => setDraft(EMPTY_DRAFT)}>
              <Plus />
              New dependency
            </Button>
          ),
        }}
      />

      {draft ? (
        <FormSection
          title={draft.isNew ? "New dependency" : `${fieldLabel(draft.controlling)} → ${fieldLabel(draft.dependent)}`}
          description="For each value of the controlling field, choose the values the dependent field may take. A value with none leaves the dependent field empty."
        >
          <FieldGroup columns={2}>
            <Field>
              <FieldLabel htmlFor="dependency-controlling">Controlling field</FieldLabel>
              <SearchableSelect
                id="dependency-controlling"
                label="Controlling field"
                value={draft.controlling}
                options={fieldOptions((field) => !field.multiple && field.field_key !== draft.dependent)}
                onValueChange={(controlling) => setDraft({ ...draft, controlling, valueMap: {} })}
                placeholder="Select"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="dependency-dependent">Dependent field</FieldLabel>
              <SearchableSelect
                id="dependency-dependent"
                label="Dependent field"
                value={draft.dependent}
                options={fieldOptions(
                  (field) => field.field_key !== draft.controlling && (!usedAsDependent.has(field.field_key) || field.field_key === draft.dependent),
                )}
                onValueChange={(dependent) => setDraft({ ...draft, dependent, valueMap: {} })}
                disabled={!draft.isNew}
                placeholder="Select"
              />
              {!draft.isNew ? <FieldDescription>Remove the dependency to choose another dependent field.</FieldDescription> : null}
            </Field>
          </FieldGroup>

          {controllingField && dependentField ? (
            <div className="mt-4 flex flex-col gap-3">
              {controllingValues.map((value) => (
                <Field key={value.key} className="md:grid md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] md:items-start md:gap-4">
                  <FieldLabel htmlFor={`dependency-map-${value.key}`} className="md:pt-2">{value.label}</FieldLabel>
                  <MultiOptionSelect
                    id={`dependency-map-${value.key}`}
                    label={`${dependentField.label} allowed for ${value.label}`}
                    options={dependentOptions}
                    values={draft.valueMap[value.key] ?? []}
                    onChange={(next) => setDraft({ ...draft, valueMap: { ...draft.valueMap, [value.key]: next } })}
                  />
                </Field>
              ))}
            </div>
          ) : null}

          {error ? <FieldError className="mt-3">{error}</FieldError> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save dependency"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setDraft(null)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </FormSection>
      ) : (query.data?.results.length ?? 0) > 0 ? (
        <div>
          <Button type="button" variant="outline" onClick={() => setDraft(EMPTY_DRAFT)}>
            <Plus />
            New dependency
          </Button>
        </div>
      ) : null}
    </PageShell>
  );
}
