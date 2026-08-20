import type { SavedViewConfig, SavedViewFilters } from "@/hooks/useSavedViews";

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

/* ============================================================================
   The address bar
   ========================================================================== */

/**
 * The URL is the draft saved view (rebuild.md 5.5).
 *
 * List state was held in React state on 15 of 16 lists, so opening a record from page 4 of
 * a filtered list and pressing back landed on page 1, unfiltered — Appendix A's A1, and the
 * highest cost x frequency item in it. The fix is not a bag of query params invented for
 * the address bar: Lynk already has a canonical shape for list state, `SavedViewConfig`,
 * and a server-side place to persist it. What it lacked was the *unsaved* copy. So the
 * address holds exactly that object, and "Save view" becomes what it says — a promotion of
 * the state already in the URL.
 *
 * **The vocabulary is the request's.** `search`, `filters_all` and `filters_any` are spelled
 * here exactly as `appendSavedViewFilterParams` spells them for the API, because two names
 * for one thing is the drift this sub-phase exists to remove. `sort`, `cols`, `page` and
 * `page_size` are the four the request encodes differently, and they are spelled the short
 * way an operator might reasonably type.
 *
 * **Only divergence is written.** A list showing its default view at page 1 has a clean URL;
 * a param appears when, and only when, the operator moved away from what the view says.
 */
export const LIST_ADDRESS_KEYS = {
  view: "view",
  search: "search",
  filtersAll: "filters_all",
  filtersAny: "filters_any",
  logic: "logic",
  sort: "sort",
  columns: "cols",
  page: "page",
  pageSize: "page_size",
} as const;

export type ListAddressSort = { key: string; direction: "asc" | "desc" } | null;

function conditionsFor(filters: SavedViewFilters | undefined, group: "all" | "any") {
  if (!filters) return [];
  const explicit = filters[group === "all" ? "all_conditions" : "any_conditions"];
  if (Array.isArray(explicit)) return explicit;
  const legacy = Array.isArray(filters.conditions) ? filters.conditions : [];
  const legacyGroup = filters.logic === "any" ? "any" : "all";
  return legacyGroup === group ? legacy : [];
}

function encodeConditions(conditions: unknown[]) {
  return JSON.stringify(
    conditions.map((condition) => {
      const value = condition as Record<string, unknown>;
      return { field: value.field, operator: value.operator, value: value.value, values: value.values };
    }),
  );
}

function decodeConditions(raw: string | null) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedViewFilters["conditions"]) ?? [] : [];
  } catch {
    // A hand-edited or truncated address is not an error state — it is a URL the operator
    // typed. Drop the unreadable half and show the list rather than a parse failure.
    return [];
  }
}

/**
 * Writes the parts of `filters` that differ from `baseline` into `params`, and deletes the
 * ones that no longer do. Mutates `params` so several writers can share one address.
 */
export function writeSavedViewFiltersToAddress(
  params: URLSearchParams,
  filters: SavedViewFilters | undefined,
  baseline: SavedViewFilters | undefined,
) {
  const search = typeof filters?.search === "string" ? filters.search.trim() : "";
  const baselineSearch = typeof baseline?.search === "string" ? baseline.search.trim() : "";
  if (search && search !== baselineSearch) params.set(LIST_ADDRESS_KEYS.search, search);
  else params.delete(LIST_ADDRESS_KEYS.search);

  for (const [group, key] of [
    ["all", LIST_ADDRESS_KEYS.filtersAll],
    ["any", LIST_ADDRESS_KEYS.filtersAny],
  ] as const) {
    const conditions = conditionsFor(filters, group);
    const baselineConditions = conditionsFor(baseline, group);
    const encoded = encodeConditions(conditions);
    if (conditions.length && encoded !== encodeConditions(baselineConditions)) params.set(key, encoded);
    else params.delete(key);
  }
}

export function readSavedViewFiltersFromAddress(
  params: URLSearchParams,
  baseline: SavedViewFilters,
): SavedViewFilters | null {
  const hasSearch = params.has(LIST_ADDRESS_KEYS.search);
  const hasAll = params.has(LIST_ADDRESS_KEYS.filtersAll);
  const hasAny = params.has(LIST_ADDRESS_KEYS.filtersAny);
  if (!hasSearch && !hasAll && !hasAny) return null;

  return {
    ...baseline,
    search: hasSearch ? params.get(LIST_ADDRESS_KEYS.search) ?? "" : baseline.search ?? "",
    ...(hasAll ? { all_conditions: decodeConditions(params.get(LIST_ADDRESS_KEYS.filtersAll)) } : {}),
    ...(hasAny ? { any_conditions: decodeConditions(params.get(LIST_ADDRESS_KEYS.filtersAny)) } : {}),
    // The two grouped keys are the shape the request speaks. A legacy `conditions` array
    // read from a saved view has already been folded into one of them by `conditionsFor`,
    // so it must not survive alongside them and be applied twice.
    ...(hasAll || hasAny ? { conditions: [] } : {}),
  };
}

export function encodeListAddressSort(sort: ListAddressSort) {
  if (!sort?.key) return "";
  return sort.direction === "desc" ? `-${sort.key}` : sort.key;
}

export function decodeListAddressSort(raw: string | null): ListAddressSort {
  if (!raw) return null;
  const desc = raw.startsWith("-");
  const key = desc ? raw.slice(1) : raw;
  return key ? { key, direction: desc ? "desc" : "asc" } : null;
}

/**
 * The whole draft, read off the address and layered over the view it started from.
 *
 * A param that is absent means "whatever the view says", not "empty" — which is why every
 * field falls back to `config` rather than to a blank. That is what makes a partial URL
 * (`?search=acme`) behave the way an operator who typed it would expect.
 */
export function readSavedViewConfigFromAddress(
  params: URLSearchParams,
  config: SavedViewConfig,
): SavedViewConfig {
  const columns = params.get(LIST_ADDRESS_KEYS.columns);
  const filters = readSavedViewFiltersFromAddress(params, config.filters ?? {});
  return {
    visible_columns: columns ? columns.split(",").filter(Boolean) : config.visible_columns,
    filters: filters ?? config.filters,
    sort: params.has(LIST_ADDRESS_KEYS.sort)
      ? decodeListAddressSort(params.get(LIST_ADDRESS_KEYS.sort))
      : config.sort ?? null,
  };
}

export function writeSavedViewConfigToAddress(
  params: URLSearchParams,
  config: SavedViewConfig,
  baseline: SavedViewConfig,
) {
  writeSavedViewFiltersToAddress(params, config.filters, baseline.filters);

  const sort = encodeListAddressSort((config.sort ?? null) as ListAddressSort);
  const baselineSort = encodeListAddressSort((baseline.sort ?? null) as ListAddressSort);
  if (sort && sort !== baselineSort) params.set(LIST_ADDRESS_KEYS.sort, sort);
  else params.delete(LIST_ADDRESS_KEYS.sort);

  const columns = (config.visible_columns ?? []).join(",");
  const baselineColumns = (baseline.visible_columns ?? []).join(",");
  if (columns && columns !== baselineColumns) params.set(LIST_ADDRESS_KEYS.columns, columns);
  else params.delete(LIST_ADDRESS_KEYS.columns);
}
