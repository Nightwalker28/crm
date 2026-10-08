"use client";

import { useMemo, type ReactNode } from "react";

import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import { ModuleImportExportControls } from "@/components/ui/ModuleImportExportControls";
import { ModuleListToolbar } from "@/components/ui/ModuleListToolbar";
import { PageShell } from "@/components/ui/PageShell";
import Pagination from "@/components/ui/Pagination";
import { RecordTable, type RecordTableColumn } from "@/components/ui/RecordTable";
import { getConditionGroups } from "@/components/ui/SavedViewConditionEditor";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { usePagedList, type PagedListResponse } from "@/hooks/usePagedList";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useSavedViews, type SavedViewFilters } from "@/hooks/useSavedViews";
import { apiFetch, isForbiddenError } from "@/lib/api";
import { apiErrorFromResponse } from "@/lib/apiErrors";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS, resolveSavedViewFilters, resolveVisibleColumns } from "@/lib/moduleViewConfigs";
import { appendSavedViewFilterParams } from "@/lib/savedViewQuery";

export type DocumentListModuleKey =
  | "purchase_orders"
  | "purchase_receipts"
  | "purchase_bills"
  | "purchase_vendor_returns"
  | "purchase_vendor_credits"
  | "inventory_deliveries"
  | "inventory_returns"
  | "inventory_adjustments"
  | "inventory_transfers"
  | "finance_credit_notes"
  | "finance_payments";

type StateSlot = { icon?: React.ComponentType<{ className?: string }>; title: string; description?: string; action?: ReactNode };

type Props<T extends { id: number }> = {
  moduleKey: DocumentListModuleKey;
  title: string;
  description?: string;
  /** The list route, e.g. `/purchasing/orders`. Its `export-job` sits beside it. */
  endpoint: string;
  searchPlaceholder: string;
  /** Every column the list can show, keyed as `moduleViewConfigs` names them; the view picks. */
  columns: RecordTableColumn<T>[];
  rowHref: (row: T) => string;
  emptyState: StateSlot;
  primaryAction?: ReactNode;
  /** The quick status filter the list had before saved views, kept as a saved-view filter. */
  statusOptions?: { value: string; label: string }[];
};

/**
 * An ERP document list (13c §3.2–3.3): saved views with their presets, inline filters, the
 * column picker, search, export of the filtered view, and paging — the toolbar the CRM
 * lists have, built once for the nine document lists rather than nine times.
 *
 * The server owns the filtering: each list route takes `filters_all` / `filters_any` through
 * `list_conditions`, and its `export-job` takes the same query string, so an export holds
 * exactly the rows on screen.
 */
export function DocumentListPage<T extends { id: number }>({
  moduleKey,
  title,
  description,
  endpoint,
  searchPlaceholder,
  columns,
  rowHref,
  emptyState,
  primaryAction,
  statusOptions,
}: Props<T>) {
  const { modules } = useAccessibleModules();
  const canExport = Boolean(modules.find((module) => module.name === moduleKey)?.actions?.can_export);
  const { fields: moduleFields } = useModuleFieldConfigs(moduleKey);
  const definition = useMemo(() => buildModuleViewDefinition(moduleKey, [], moduleFields), [moduleKey, moduleFields]);
  const defaultConfig = definition?.defaultConfig ?? MODULE_VIEW_DEFAULTS[moduleKey];
  const { views, selectedViewId, setSelectedViewId, draftConfig, setDraftConfig } = useSavedViews(moduleKey, defaultConfig);
  const activeFilters = resolveSavedViewFilters(definition, draftConfig.filters);
  const visibleColumns = resolveVisibleColumns(definition, draftConfig, defaultConfig);
  const status = typeof activeFilters.status === "string" ? activeFilters.status : "all";

  const list = usePagedList<T, PagedListResponse<T>>({
    queryKey: ["document-list", moduleKey],
    fetcher: async (page, pageSize, filters) => {
      const params = listParams(filters);
      params.set("page", String(page));
      params.set("page_size", String(pageSize));
      const response = await apiFetch(`${endpoint}?${params}`);
      if (!response.ok) throw await apiErrorFromResponse(response, `${title} could not be loaded.`);
      return response.json() as Promise<PagedListResponse<T>>;
    },
    visibleColumns,
    filters: activeFilters,
  });

  const { allConditions, anyConditions } = getConditionGroups(activeFilters);
  const activeFilterCount = allConditions.length + anyConditions.length + (status === "all" ? 0 : 1);
  const hasActiveFilters = Boolean((typeof activeFilters.search === "string" && activeFilters.search.trim()) || activeFilterCount);
  const shownColumns = useMemo(
    () => visibleColumns.map((key) => columns.find((column) => column.key === key)).filter((column): column is RecordTableColumn<T> => Boolean(column)),
    [columns, visibleColumns],
  );

  function setFilters(next: (current: SavedViewFilters) => SavedViewFilters) {
    setDraftConfig((current) => ({ ...current, filters: next(current.filters) }));
  }

  function clearFilters() {
    setFilters((current) => ({ ...current, search: "", status: "all", conditions: [], all_conditions: [], any_conditions: [] }));
  }

  return (
    <PageShell variant="list" title={title} description={description}>
      <ModuleListToolbar
        searchValue={typeof activeFilters.search === "string" ? activeFilters.search : ""}
        onSearchChange={(search) => setFilters((current) => ({ ...current, search }))}
        searchPlaceholder={searchPlaceholder}
        filtersOpen={Boolean(activeFilters.filtersOpen)}
        activeFilterCount={activeFilterCount}
        onToggleFilters={() => setFilters((current) => ({ ...current, filtersOpen: !current.filtersOpen }))}
        columnOptions={definition?.columns ?? []}
        visibleColumns={visibleColumns}
        onVisibleColumnsChange={(nextColumns) => setDraftConfig((current) => ({ ...current, visible_columns: nextColumns }))}
        onClearFilters={clearFilters}
        viewControls={
          <>
            <SavedViewSelector moduleKey={moduleKey} views={views} selectedViewId={selectedViewId} onSelect={setSelectedViewId} />
            {statusOptions ? (
              <Select value={status} onValueChange={(value) => setFilters((current) => ({ ...current, status: value }))}>
                <SelectTrigger className="w-44" aria-label={`${title} status`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {statusOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : null}
          </>
        }
        actionControls={canExport ? (
          <ModuleImportExportControls
            exportEndpoint={`${endpoint}/export-job?${listParams(activeFilters)}`}
            exportMethod="POST"
            scopedExport={false}
            exportDescription="Exports every record in the current view, with its filters and search, as a CSV file."
          />
        ) : undefined}
        primaryAction={primaryAction}
      />
      <InlineSavedViewFilters filterFields={definition?.filterFields ?? []} filters={activeFilters} onChange={(filters) => setFilters(() => filters)} hideHeader />
      <RecordTable
        label={title}
        rows={list.items}
        rowKey={(row) => row.id}
        rowHref={rowHref}
        columns={shownColumns}
        isLoading={list.isLoading}
        isRefreshing={list.isFetching && !list.isLoading}
        isPermissionDenied={isForbiddenError(list.query.error)}
        hasError={Boolean(list.query.error) && !isForbiddenError(list.query.error)}
        onRetry={() => void list.refresh()}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={clearFilters}
        emptyState={emptyState}
      />
      <Pagination
        page={list.page}
        totalPages={list.totalPages}
        totalCount={list.totalCount}
        rangeStart={list.rangeStart}
        rangeEnd={list.rangeEnd}
        pageSize={list.pageSize}
        isRefreshing={list.isFetching && !list.isLoading}
        onPageChange={list.goToPage}
        onPageSizeChange={list.onPageSizeChange}
      />
    </PageShell>
  );
}

/** The list's filters as its route reads them: search, the quick status, and the conditions. */
function listParams(filters: SavedViewFilters): URLSearchParams {
  const params = new URLSearchParams();
  appendSavedViewFilterParams(params, filters);
  if (typeof filters.status === "string" && filters.status !== "all") params.set("status", filters.status);
  return params;
}
