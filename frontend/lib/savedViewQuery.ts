import type { SavedViewFilters } from "@/hooks/useSavedViews";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = stableValue((value as Record<string, unknown>)[key]);
      return acc;
    }, {});
}

function comparableCondition(condition: Record<string, unknown>) {
  return stableValue({
    field: condition.field,
    operator: condition.operator,
    value: condition.value,
    values: condition.values,
  });
}

function conditionKey(condition: Record<string, unknown>) {
  return JSON.stringify(comparableCondition(condition));
}

export function canonicalSavedViewConditionsKey(conditions: unknown[] = []) {
  return JSON.stringify(
    conditions
      .filter((condition): condition is Record<string, unknown> => Boolean(condition) && typeof condition === "object")
      .map(comparableCondition)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  );
}

export function canonicalSavedViewFiltersKey(filters: SavedViewFilters | undefined) {
  if (!filters) return "{}";
  const normalized = stableValue(filters) as Record<string, unknown>;
  for (const key of ["conditions", "all_conditions", "any_conditions"]) {
    if (Array.isArray(filters[key])) {
      normalized[key] = [...filters[key]]
        .filter((condition): condition is Record<string, unknown> => Boolean(condition) && typeof condition === "object")
        .sort((left, right) => conditionKey(left).localeCompare(conditionKey(right)))
        .map(comparableCondition);
    }
  }
  return JSON.stringify(normalized);
}

export function appendSavedViewFilterParams(params: URLSearchParams, filters: SavedViewFilters | undefined) {
  if (!filters) return;

  const search = typeof filters.search === "string" ? filters.search.trim() : "";
  const allConditions = Array.isArray(filters.all_conditions)
    ? filters.all_conditions
    : Array.isArray(filters.conditions) && filters.logic !== "any"
      ? filters.conditions
      : [];
  const anyConditions = Array.isArray(filters.any_conditions)
    ? filters.any_conditions
    : Array.isArray(filters.conditions) && filters.logic === "any"
      ? filters.conditions
      : [];

  if (search) {
    params.set("search", search);
    params.set("query", search);
  }

  if (allConditions.length) {
    params.set(
      "filters_all",
      JSON.stringify(
        allConditions.map((condition) => ({
          field: condition.field,
          operator: condition.operator,
          value: condition.value,
          values: condition.values,
        })),
      ),
    );
  }

  if (anyConditions.length) {
    params.set(
      "filters_any",
      JSON.stringify(
        anyConditions.map((condition) => ({
          field: condition.field,
          operator: condition.operator,
          value: condition.value,
          values: condition.values,
        })),
      ),
    );
  }
}

export function buildSavedViewExportPayload(filters: SavedViewFilters | undefined) {
  if (!filters) return {};

  const search = typeof filters.search === "string" ? filters.search.trim() : "";
  const status = typeof filters.status === "string" ? filters.status.trim() : "";
  const allConditions = Array.isArray(filters.all_conditions)
    ? filters.all_conditions
    : Array.isArray(filters.conditions) && filters.logic !== "any"
      ? filters.conditions
      : [];
  const anyConditions = Array.isArray(filters.any_conditions)
    ? filters.any_conditions
    : Array.isArray(filters.conditions) && filters.logic === "any"
      ? filters.conditions
      : [];

  return {
    ...(search ? { search } : {}),
    ...(status && status !== "all" ? { status } : {}),
    ...(allConditions.length
      ? {
          filters_all: allConditions.map((condition) => ({
            field: condition.field,
            operator: condition.operator,
            value: condition.value,
            values: condition.values,
          })),
        }
      : {}),
    ...(anyConditions.length
      ? {
          filters_any: anyConditions.map((condition) => ({
            field: condition.field,
            operator: condition.operator,
            value: condition.value,
            values: condition.values,
          })),
        }
      : {}),
  };
}
