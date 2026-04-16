"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { ColumnPicker } from "@/components/ui/ColumnPicker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { useSavedViews, type SavedViewCondition, type SavedViewFilterOperator } from "@/hooks/useSavedViews";
import { buildModuleViewDefinition, CUSTOM_FIELD_SUPPORTED_MODULES } from "@/lib/moduleViewConfigs";

const OPERATOR_LABELS: Record<SavedViewFilterOperator, string> = {
  is: "is",
  is_not: "is not",
  contains: "contains",
  not_contains: "does not contain",
  in: "in",
  not_in: "not in",
  gt: "greater than",
  gte: "greater than or equal",
  lt: "less than",
  lte: "less than or equal",
  is_empty: "is empty",
  is_not_empty: "is not empty",
};

function buildCondition(): SavedViewCondition {
  return {
    id: crypto.randomUUID(),
    field: "",
    operator: "is",
    value: "",
    values: [],
  };
}

function getConditionGroups(filters: Record<string, unknown>) {
  const allConditions = Array.isArray(filters.all_conditions)
    ? (filters.all_conditions as SavedViewCondition[])
    : Array.isArray(filters.conditions) && filters.logic !== "any"
      ? (filters.conditions as SavedViewCondition[])
      : [];
  const anyConditions = Array.isArray(filters.any_conditions)
    ? (filters.any_conditions as SavedViewCondition[])
    : Array.isArray(filters.conditions) && filters.logic === "any"
      ? (filters.conditions as SavedViewCondition[])
      : [];
  return { allConditions, anyConditions };
}

export default function ManageModuleViewPage() {
  const params = useParams<{ moduleKey: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const moduleKey = params.moduleKey;
  const { data: customFields = [] } = useModuleCustomFields(
    moduleKey,
    CUSTOM_FIELD_SUPPORTED_MODULES.has(moduleKey),
  );
  const definition = useMemo(
    () => buildModuleViewDefinition(moduleKey, customFields),
    [customFields, moduleKey],
  );
  const safeDefinition = definition ?? {
    key: moduleKey,
    label: "Module",
    route: "/dashboard",
    columns: [],
    filterFields: [],
    defaultConfig: { visible_columns: [], filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [] }, sort: null },
  };
  const requestedViewId = searchParams.get("viewId") ?? "system-default";

  const [viewName, setViewName] = useState("");

  const {
    views,
    selectedView,
    selectedViewId,
    setSelectedViewId,
    draftConfig,
    setDraftConfig,
    createViewWithConfig,
    updateView,
    setCurrentAsDefault,
    deleteCurrentView,
    isSaving,
  } = useSavedViews(moduleKey, safeDefinition.defaultConfig);

  if (!definition) {
    return (
      <div className="mx-auto max-w-4xl">
        <Card className="px-6 py-6 text-neutral-200">Unsupported module view.</Card>
      </div>
    );
  }

  useEffect(() => {
    if (selectedViewId !== requestedViewId) {
      setSelectedViewId(requestedViewId);
    }
  }, [requestedViewId, selectedViewId, setSelectedViewId]);

  useEffect(() => {
    setViewName(selectedView && !selectedView.is_system ? selectedView.name : "");
  }, [selectedView]);

  const filterFields = definition.filterFields;
  const visibleColumns = draftConfig.visible_columns?.length ? draftConfig.visible_columns : definition.defaultConfig.visible_columns;
  const { allConditions, anyConditions } = getConditionGroups(draftConfig.filters);
  const selectedFieldMap = useMemo(
    () => new Map(filterFields.map((field) => [field.key, field])),
    [filterFields],
  );

  async function handleSave() {
    if (!selectedView) return;

    if (selectedView.is_system || selectedView.id == null) {
      if (!viewName.trim()) {
        toast.error("View name is required.");
        return;
      }
      const created = await createViewWithConfig({
        name: viewName.trim(),
        config: draftConfig,
      });
      toast.success("Saved view created.");
      router.replace(`/dashboard/views/${moduleKey}?viewId=${created.id}`);
      return;
    }

    await updateView(selectedView.id, {
      name: viewName.trim() || selectedView.name,
      config: draftConfig,
    });
    toast.success("Saved view updated.");
  }

  async function handleSetDefault() {
    if (!selectedView || selectedView.id == null) {
      toast.error("Create or select a personal view first.");
      return;
    }
    await setCurrentAsDefault();
    toast.success("Default view updated.");
  }

  async function handleDelete() {
    if (!selectedView || selectedView.id == null) return;
    if (!window.confirm(`Delete the view "${selectedView.name}"?`)) return;
    await deleteCurrentView();
    toast.success("Saved view deleted.");
    router.replace(`/dashboard/views/${moduleKey}?viewId=system-default`);
  }

  function updateCondition(group: "all" | "any", index: number, patch: Partial<SavedViewCondition>) {
    setDraftConfig((current) => {
      const key = group === "all" ? "all_conditions" : "any_conditions";
      const currentConditions = Array.isArray(current.filters[key]) ? (current.filters[key] as SavedViewCondition[]) : [];
      const nextConditions = [...currentConditions];
      nextConditions[index] = { ...nextConditions[index], ...patch };
      return {
        ...current,
        filters: {
          ...current.filters,
          conditions: [],
          [key]: nextConditions,
        },
      };
    });
  }

  function addCondition(group: "all" | "any") {
    setDraftConfig((current) => ({
      ...current,
      filters: {
        ...current.filters,
        conditions: [],
        [group === "all" ? "all_conditions" : "any_conditions"]: [
          ...(Array.isArray(current.filters[group === "all" ? "all_conditions" : "any_conditions"])
            ? (current.filters[group === "all" ? "all_conditions" : "any_conditions"] as SavedViewCondition[])
            : []),
          buildCondition(),
        ],
      },
    }));
  }

  function removeCondition(group: "all" | "any", index: number) {
    setDraftConfig((current) => ({
      ...current,
      filters: {
        ...current.filters,
        conditions: [],
        [group === "all" ? "all_conditions" : "any_conditions"]: (
          Array.isArray(current.filters[group === "all" ? "all_conditions" : "any_conditions"])
            ? (current.filters[group === "all" ? "all_conditions" : "any_conditions"] as SavedViewCondition[])
            : []
        ).filter((_, currentIndex) => currentIndex !== index),
      },
    }));
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Button asChild type="button" variant="ghost" size="sm" className="mb-3 px-0 text-neutral-400 hover:text-neutral-100">
            <Link href={definition.route}>
              <ArrowLeft className="h-4 w-4" />
              Back to {definition.label}
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold text-neutral-100">Manage {definition.label} View</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Define columns, default search, and AND/OR filter conditions for this module view.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedViewId} onValueChange={(value) => router.replace(`/dashboard/views/${moduleKey}?viewId=${value}`)}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Select view" />
            </SelectTrigger>
            <SelectContent>
              {views.map((view) => (
                <SelectItem key={String(view.id ?? "system-default")} value={String(view.id ?? "system-default")}>
                  {view.name}{view.is_default ? " (Default)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" onClick={() => router.replace(`/dashboard/views/${moduleKey}?viewId=system-default`)}>
            New From Default
          </Button>
        </div>
      </div>

      <Card className="px-5 py-5">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
          <div className="space-y-2">
            <Label htmlFor="view-name">View name</Label>
            <Input
              id="view-name"
              value={viewName}
              onChange={(event) => setViewName(event.target.value)}
              placeholder={selectedView?.is_system ? `New ${definition.label} view` : "View name"}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="default-search">Default search</Label>
            <Input
              id="default-search"
              value={typeof draftConfig.filters.search === "string" ? draftConfig.filters.search : ""}
              onChange={(event) =>
                setDraftConfig((current) => ({
                  ...current,
                  filters: {
                    ...current.filters,
                    search: event.target.value,
                  },
                }))
              }
              placeholder={`Search ${definition.label.toLowerCase()}`}
            />
          </div>
        </div>
      </Card>

      <Card className="px-5 py-5">
        <div>
          <h2 className="text-lg font-semibold text-neutral-100">Columns</h2>
          <p className="mt-1 text-sm text-neutral-400">Choose which columns appear in this view and the order they render.</p>
        </div>
        <div className="mt-4">
          <ColumnPicker
            title={`${definition.label} columns`}
            options={definition.columns}
            visibleColumns={visibleColumns}
            forceOpen
            onChange={(next) =>
              setDraftConfig((current) => ({
                ...current,
                visible_columns: next,
              }))
            }
          />
        </div>
      </Card>

      <Card className="px-5 py-5">
        <div>
          <h2 className="text-lg font-semibold text-neutral-100">Conditions</h2>
          <p className="mt-1 text-sm text-neutral-400">
            Add required conditions in the AND group, optional-match conditions in the OR group, or use both together.
          </p>
        </div>

        {([
          ["all", "All conditions must match", allConditions],
          ["any", "Any of these conditions may match", anyConditions],
        ] as const).map(([groupKey, groupLabel, groupConditions]) => (
          <div key={groupKey} className="mt-6">
            <div className="mb-3 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-neutral-200">{groupLabel}</h3>
                <p className="mt-1 text-xs text-neutral-500">
                  {groupKey === "all"
                    ? "Records must satisfy every condition in this section."
                    : "Records must satisfy at least one condition in this section."}
                </p>
              </div>
              <Button type="button" variant="outline" onClick={() => addCondition(groupKey)}>
                <Plus className="h-4 w-4" />
                Add {groupKey === "all" ? "AND" : "OR"} Condition
              </Button>
            </div>

            <div className="space-y-3">
              {groupConditions.length ? (
                groupConditions.map((condition, index) => {
                  const selectedField = selectedFieldMap.get(condition.field);
                  const operators = selectedField?.operators ?? ["is"];
                  const usesListValue = condition.operator === "in" || condition.operator === "not_in";
                  const hidesValue = condition.operator === "is_empty" || condition.operator === "is_not_empty";
                  return (
                    <div key={condition.id ?? `${condition.field}-${index}`} className="grid gap-3 rounded-xl border border-neutral-800 bg-neutral-950/60 px-4 py-4 md:grid-cols-[1.3fr_1fr_1.2fr_auto]">
                      <div className="space-y-2">
                        <Label>Field</Label>
                        <Select
                          value={condition.field || undefined}
                          onValueChange={(value) =>
                            updateCondition(groupKey, index, {
                              field: value,
                              operator: selectedFieldMap.get(value)?.operators?.[0] ?? "is",
                              value: "",
                              values: [],
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Choose field" />
                          </SelectTrigger>
                          <SelectContent>
                            {filterFields.map((field) => (
                              <SelectItem key={field.key} value={field.key}>
                                {field.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Operator</Label>
                        <Select
                          value={condition.operator}
                          onValueChange={(value) =>
                            updateCondition(groupKey, index, {
                              operator: value as SavedViewFilterOperator,
                              value: "",
                              values: [],
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {operators.map((operator) => (
                              <SelectItem key={operator} value={operator}>
                                {OPERATOR_LABELS[operator]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Value</Label>
                        {hidesValue ? (
                          <div className="flex h-10 items-center rounded-md border border-neutral-800 px-3 text-sm text-neutral-500">
                            No value needed
                          </div>
                        ) : selectedField?.type === "select" && selectedField.options && !usesListValue ? (
                          <Select
                            value={typeof condition.value === "string" ? condition.value : ""}
                            onValueChange={(value) => updateCondition(groupKey, index, { value })}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Choose value" />
                            </SelectTrigger>
                            <SelectContent>
                              {selectedField.options.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            type={selectedField?.type === "number" ? "number" : selectedField?.type === "date" ? "date" : "text"}
                            value={
                              usesListValue
                                ? Array.isArray(condition.values)
                                  ? condition.values.join(", ")
                                  : typeof condition.values === "string"
                                    ? condition.values
                                    : ""
                                : typeof condition.value === "string" || typeof condition.value === "number"
                                  ? String(condition.value)
                                  : ""
                            }
                            onChange={(event) =>
                              updateCondition(
                                groupKey,
                                index,
                                usesListValue
                                  ? { values: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) }
                                  : { value: event.target.value },
                              )
                            }
                            placeholder={usesListValue ? "Comma-separated values" : "Value"}
                          />
                        )}
                      </div>
                      <div className="flex items-end">
                        <Button type="button" variant="outline" size="sm" onClick={() => removeCondition(groupKey, index)}>
                          <Trash2 className="h-4 w-4" />
                          Remove
                        </Button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-xl border border-dashed border-neutral-800 px-4 py-5 text-sm text-neutral-500">
                  No {groupKey === "all" ? "AND" : "OR"} conditions yet.
                </div>
              )}
            </div>
          </div>
        ))}
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button type="button" variant="outline" onClick={handleSetDefault} disabled={!selectedView || selectedView.id == null || isSaving}>
          Set Default
        </Button>
        <Button type="button" variant="outline" onClick={handleDelete} disabled={!selectedView || selectedView.id == null || isSaving}>
          Delete
        </Button>
        <Button type="button" onClick={() => void handleSave()} disabled={isSaving}>
          {selectedView?.is_system || selectedView?.id == null ? "Create View" : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}
