"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

import InsertionOrdersList from "@/components/finance/insertionOrderList";
import { useInsertionOrders } from "@/hooks/finance/useInsertionOrders";
import Pagination from "@/components/ui/Pagination";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import { ModuleImportExportControls } from "@/components/ui/ModuleImportExportControls";
import { ModuleListToolbar } from "@/components/ui/ModuleListToolbar";
import { PageShell } from "@/components/ui/PageShell";
import type { InsertionOrderSortState } from "@/hooks/finance/useInsertionOrders";
import { Button } from "@/components/ui/button";
import { getConditionGroups } from "@/components/ui/SavedViewConditionEditor";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useSavedViews } from "@/hooks/useSavedViews";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS, resolveSavedViewFilters, resolveVisibleColumns } from "@/lib/moduleViewConfigs";
import { buildSavedViewExportPayload } from "@/lib/savedViewQuery";

type InsertionOrderTableSortState = { column: string; direction: "asc" | "desc" } | null;

export default function InsertionOrdersPage() {
  const { modules, isLoading: modulesLoading } = useAccessibleModules();
  const accessibleModule = modules.find((module) => module.name === "finance_io");
  const canCreate = Boolean(accessibleModule?.actions?.can_create);
  const canExport = Boolean(accessibleModule?.actions?.can_export);
  const { data: customFields = [] } = useModuleCustomFields("finance_io");
  const { fields: moduleFields } = useModuleFieldConfigs("finance_io");
  const definition = useMemo(
    () => buildModuleViewDefinition("finance_io", customFields, moduleFields),
    [customFields, moduleFields],
  );
  const defaultConfig = definition?.defaultConfig ?? MODULE_VIEW_DEFAULTS.finance_io;
  const {
    views,
    selectedViewId,
    setSelectedViewId,
    draftConfig,
    setDraftConfig,
  } = useSavedViews(
    "finance_io",
    defaultConfig,
  );
  const visibleColumns = resolveVisibleColumns(definition, draftConfig, defaultConfig);
  const activeFilters = resolveSavedViewFilters(definition, draftConfig.filters);
  const statusFilter = typeof activeFilters?.status === "string" ? activeFilters.status : "all";
  const sort = useMemo<InsertionOrderSortState>(() => {
    const rawSort = draftConfig.sort;
    if (!rawSort) {
      return null;
    }
    const key =
      typeof rawSort.key === "string"
        ? rawSort.key
        : typeof rawSort.column === "string"
          ? rawSort.column
          : null;
    if (!key) {
      return null;
    }
    return { key, direction: rawSort.direction === "desc" ? "desc" : "asc" };
  }, [draftConfig.sort]);
  const {
    orders,
    page,
    pageSize,
    totalPages,
    isLoading,
    isFetching,
    error,
    goToPage,
    onPageSizeChange,
    refresh,
    totalCount,
    rangeStart,
    rangeEnd,
  } = useInsertionOrders(visibleColumns, activeFilters, sort);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const { allConditions, anyConditions } = getConditionGroups(activeFilters);
  const activeFilterCount = allConditions.length + anyConditions.length + (statusFilter === "all" ? 0 : 1);
  const hasActiveFilters = Boolean(
    (typeof activeFilters.search === "string" && activeFilters.search.trim()) || activeFilterCount,
  );
  const currentPageIds = useMemo(() => orders.map((order) => order.id), [orders]);

  function toggleRow(orderId: number, checked: boolean) {
    setSelectedIds((current) =>
      checked ? Array.from(new Set([...current, orderId])) : current.filter((id) => id !== orderId),
    );
  }

  function toggleCurrentPage(checked: boolean) {
    setSelectedIds((current) => {
      if (checked) {
        return Array.from(new Set([...current, ...currentPageIds]));
      }
      return current.filter((id) => !currentPageIds.includes(id));
    });
  }

  function handleSortChange(nextSort: InsertionOrderTableSortState) {
    setDraftConfig((current) => ({
      ...current,
      sort: nextSort ? { key: nextSort.column, direction: nextSort.direction } : null,
    }));
  }

  function clearFilters() {
    setDraftConfig((current) => ({
      ...current,
      filters: {
        ...current.filters,
        search: "",
        status: "all",
        conditions: [],
        all_conditions: [],
        any_conditions: [],
      },
    }));
  }

  return (
    <PageShell
      variant="list"
      title="Insertion orders"
      isLoading={modulesLoading}
      isPermissionDenied={!modulesLoading && !accessibleModule?.actions?.can_view}
    >
        <ModuleListToolbar
          searchValue={typeof activeFilters?.search === "string" ? activeFilters.search : ""}
          onSearchChange={(value) =>
            setDraftConfig((current) => ({
              ...current,
              filters: { ...current.filters, search: value },
            }))
          }
          searchPlaceholder="Search insertion orders"
          filtersOpen={Boolean(activeFilters.filtersOpen)}
          activeFilterCount={activeFilterCount}
          onToggleFilters={() =>
            setDraftConfig((current) => ({
              ...current,
              filters: { ...current.filters, filtersOpen: !current.filters.filtersOpen },
            }))
          }
          onClearFilters={clearFilters}
          selectedCount={selectedIds.length}
          selectionNoun="order"
          onClearSelection={() => setSelectedIds([])}
          viewControls={
            <SavedViewSelector
              moduleKey="finance_io"
              views={views}
              selectedViewId={selectedViewId}
              onSelect={setSelectedViewId}
            />
          }
          actionControls={
            <>
              <div className="flex flex-wrap gap-1" aria-label="Order status">
                {["all", "draft", "issued", "active", "completed", "cancelled"].map((status) => (
                  <Button
                    key={status}
                    type="button"
                    size="sm"
                    variant={statusFilter === status ? "secondary" : "ghost"}
                    onClick={() =>
                      setDraftConfig((current) => ({
                        ...current,
                        filters: { ...current.filters, status },
                      }))
                    }
                  >
                    {status === "all" ? "All" : status.charAt(0).toUpperCase() + status.slice(1)}
                  </Button>
                ))}
              </div>
              <ModuleImportExportControls
                importEndpoint={canCreate ? "/finance/insertion-orders/import" : undefined}
                exportEndpoint={canExport ? "/finance/insertion-orders/export" : undefined}
                exportMethod="POST"
                exportBody={buildSavedViewExportPayload(activeFilters)}
                onImportSuccess={refresh}
                selectedIds={selectedIds}
                currentPageIds={currentPageIds}
              />
            </>
          }
          primaryAction={canCreate ? <Button asChild><Link href="/dashboard/finance/insertion-orders/new"><Plus />New order</Link></Button> : undefined}
        />

        <InlineSavedViewFilters
          filterFields={definition?.filterFields ?? []}
          filters={activeFilters}
          onChange={(nextFilters) =>
            setDraftConfig((current) => ({
              ...current,
              filters: nextFilters,
            }))
          }
          hideHeader
        />

        <InsertionOrdersList
          orders={orders}
          isLoading={isLoading}
          isRefreshing={isFetching && !isLoading}
          visibleColumns={visibleColumns}
          columnOptions={definition?.columns ?? []}
          selectedIds={selectedIds}
          onToggleRow={toggleRow}
          onToggleCurrentPage={toggleCurrentPage}
          sort={sort ? { column: sort.key, direction: sort.direction } : null}
          onSortChange={handleSortChange}
          selectionEnabled={canExport}
          hasActiveFilters={hasActiveFilters}
          hasError={Boolean(error)}
          onRetry={refresh}
          canCreate={canCreate}
          onClearFilters={clearFilters}
        />

        {!error ? <Pagination
          page={page}
          totalPages={totalPages}
          totalCount={totalCount}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          pageSize={pageSize}
          isRefreshing={isFetching && !isLoading}
          onPageChange={goToPage}
          onPageSizeChange={onPageSizeChange}
        /> : null}
    </PageShell>
  );
}
