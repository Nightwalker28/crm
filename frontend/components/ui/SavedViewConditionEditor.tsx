"use client";

import { Plus, Trash2 } from "lucide-react";

import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type {
  SavedViewCondition,
  SavedViewFilterOperator,
  SavedViewFilters,
} from "@/hooks/useSavedViews";
import type { ModuleFilterField } from "@/lib/moduleViewConfigs";

export const OPERATOR_LABELS: Record<SavedViewFilterOperator, string> = {
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

function createConditionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `condition-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildCondition(): SavedViewCondition {
  return {
    id: createConditionId(),
    field: "",
    operator: "is",
    value: "",
    values: [],
  };
}

export function getConditionGroups(filters: SavedViewFilters | Record<string, unknown>) {
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

type Props = {
  filterFields: ModuleFilterField[];
  filters: SavedViewFilters;
  onChange: (next: SavedViewFilters) => void;
  allConditions?: SavedViewCondition[];
  anyConditions?: SavedViewCondition[];
  title?: string;
  description?: string;
  wrapInCard?: boolean;
};

function ConditionGroupsContent({
  filterFields,
  filters,
  onChange,
  allConditions,
  anyConditions,
  title,
  description,
}: Required<Pick<Props, "allConditions" | "anyConditions">> & Omit<Props, "wrapInCard" | "allConditions" | "anyConditions">) {
  const selectedFieldMap = new Map(filterFields.map((field) => [field.key, field]));

  function updateGroup(
    group: "all" | "any",
    updater: (current: SavedViewCondition[]) => SavedViewCondition[],
  ) {
    const key = group === "all" ? "all_conditions" : "any_conditions";
    const currentConditions = group === "all" ? allConditions : anyConditions;
    onChange({
      ...filters,
      conditions: [],
      [key]: updater(currentConditions),
    });
  }

  function updateCondition(group: "all" | "any", index: number, patch: Partial<SavedViewCondition>) {
    updateGroup(group, (currentConditions) => {
      const nextConditions = [...currentConditions];
      nextConditions[index] = { ...nextConditions[index], ...patch };
      return nextConditions;
    });
  }

  function addCondition(group: "all" | "any") {
    updateGroup(group, (currentConditions) => [...currentConditions, buildCondition()]);
  }

  function removeCondition(group: "all" | "any", index: number) {
    updateGroup(group, (currentConditions) => currentConditions.filter((_, currentIndex) => currentIndex !== index));
  }

  return (
    <>
      {(title || description) ? (
        <div>
          {title ? <h2 className="text-lg font-semibold text-copy-primary">{title}</h2> : null}
          {description ? <p className="mt-1 text-sm text-copy-secondary">{description}</p> : null}
        </div>
      ) : null}

      {([
        ["all", "All conditions must match", allConditions],
        ["any", "Any of these conditions may match", anyConditions],
      ] as const).map(([groupKey, groupLabel, groupConditions]) => (
        <div key={groupKey} className={title || description ? "mt-6" : ""}>
          <div className="mb-3 flex items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-copy-primary">{groupLabel}</h3>
              <p className="mt-1 text-xs text-copy-muted">
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
                const relationValue = Number(condition.value);
                const relationValueId = Number.isInteger(relationValue) && relationValue > 0 ? relationValue : null;

                return (
                  <div
                    key={condition.id ?? `${condition.field}-${index}`}
                    className="grid gap-3 rounded-[var(--radius-card)] border border-line-default bg-surface-muted px-4 py-4 md:grid-cols-[1.3fr_1fr_1.2fr_auto]"
                  >
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
                            value_label: "",
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
                            value_label: "",
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
                        <div className="flex h-10 items-center rounded-md border border-line-default px-3 text-sm text-copy-muted">
                          No value needed
                        </div>
                      ) : selectedField?.type === "relation" && selectedField.recordType ? (
                        <LinkedRecordPicker
                          recordType={selectedField.recordType}
                          valueId={relationValueId}
                          displayValue={
                            typeof condition.value_label === "string"
                              ? condition.value_label
                              : relationValueId
                                ? `${selectedField.label} #${relationValueId}`
                                : ""
                          }
                          onDisplayValueChange={(value_label) =>
                            updateCondition(groupKey, index, { value: "", value_label })
                          }
                          onSelect={(option) =>
                            updateCondition(groupKey, index, { value: option.id, value_label: option.label })
                          }
                          onClear={() =>
                            updateCondition(groupKey, index, { value: "", value_label: "" })
                          }
                          placeholder={`Search ${selectedField.label.toLowerCase()}`}
                          queryKeyPrefix="saved-view-relation-filter"
                          noResultsText={`No ${selectedField.label.toLowerCase()} matched this search.`}
                          sourceModuleKey={selectedField.sourceModuleKey}
                          sourceAction="view"
                        />
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
              <div className="rounded-[var(--radius-card)] border border-dashed border-line-default px-4 py-5 text-sm text-copy-muted">
                No {groupKey === "all" ? "AND" : "OR"} conditions yet.
              </div>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

export function SavedViewConditionEditor({
  filterFields,
  filters,
  onChange,
  allConditions: providedAllConditions,
  anyConditions: providedAnyConditions,
  title,
  description,
  wrapInCard = true,
}: Props) {
  const conditionGroups =
    providedAllConditions && providedAnyConditions
      ? { allConditions: providedAllConditions, anyConditions: providedAnyConditions }
      : getConditionGroups(filters);

  if (wrapInCard) {
    return (
      <Card className="px-5 py-5">
        <ConditionGroupsContent
          filterFields={filterFields}
          filters={filters}
          onChange={onChange}
          allConditions={conditionGroups.allConditions}
          anyConditions={conditionGroups.anyConditions}
          title={title}
          description={description}
        />
      </Card>
    );
  }

  return (
    <ConditionGroupsContent
      filterFields={filterFields}
      filters={filters}
      onChange={onChange}
      allConditions={conditionGroups.allConditions}
      anyConditions={conditionGroups.anyConditions}
      title={title}
      description={description}
    />
  );
}
