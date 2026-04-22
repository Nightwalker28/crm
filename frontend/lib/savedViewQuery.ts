import type { SavedViewFilters } from "@/hooks/useSavedViews";

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
