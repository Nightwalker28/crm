"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

import OrdersTable from "@/components/orders/OrdersTable";
import Pagination from "@/components/ui/Pagination";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import { ModuleListToolbar } from "@/components/ui/ModuleListToolbar";
import { PageHeader } from "@/components/ui/PageHeader";
import { getConditionGroups } from "@/components/ui/SavedViewConditionEditor";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { Button } from "@/components/ui/button";
import { useOrders, type OrderSortState } from "@/hooks/sales/useOrders";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useSavedViews } from "@/hooks/useSavedViews";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS, resolveSavedViewFilters, resolveVisibleColumns } from "@/lib/moduleViewConfigs";

export default function OrdersPage() {
  const { data: customFields = [] } = useModuleCustomFields("sales_orders");
  const { fields: moduleFields } = useModuleFieldConfigs("sales_orders");
  const definition = useMemo(() => buildModuleViewDefinition("sales_orders", customFields, moduleFields), [customFields, moduleFields]);
  const defaultConfig = definition?.defaultConfig ?? MODULE_VIEW_DEFAULTS.sales_orders;
  const { views, selectedViewId, setSelectedViewId, draftConfig, setDraftConfig } = useSavedViews("sales_orders", defaultConfig);
  const visibleColumns = resolveVisibleColumns(definition, draftConfig, defaultConfig);
  const activeFilters = resolveSavedViewFilters(definition, draftConfig.filters);
  const activeSort = useMemo<OrderSortState>(() => {
    const sort = draftConfig.sort;
    if (!sort || typeof sort.key !== "string") return null;
    return {
      key: sort.key,
      direction: sort.direction === "desc" ? "desc" : "asc",
    };
  }, [draftConfig.sort]);
  const { orders, page, totalPages, totalCount, rangeStart, rangeEnd, pageSize, onPageSizeChange, isLoading, isFetching, error, goToPage, refresh } = useOrders(visibleColumns, activeFilters, activeSort);
  const { allConditions, anyConditions } = getConditionGroups(activeFilters);
  const activeFilterCount = allConditions.length + anyConditions.length;
  const hasActiveFilters = Boolean((typeof activeFilters.search === "string" && activeFilters.search.trim()) || activeFilterCount);
  const clearFilters = () => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search: "", conditions: [], all_conditions: [], any_conditions: [] } }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Orders" description="Track confirmed sales orders created from accepted quotes or entered manually." eyebrow={totalCount ? `${totalCount} order${totalCount === 1 ? "" : "s"} in this view` : undefined} actions={<Button asChild><Link href="/dashboard/sales/orders/new"><Plus />Create order</Link></Button>} />
      <ModuleListToolbar searchValue={typeof activeFilters.search === "string" ? activeFilters.search : ""} onSearchChange={(search) => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search } }))} searchPlaceholder="Search orders" filtersOpen={Boolean(activeFilters.filtersOpen)} activeFilterCount={activeFilterCount} onToggleFilters={() => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, filtersOpen: !current.filters.filtersOpen } }))} onClearFilters={clearFilters} viewControls={<SavedViewSelector moduleKey="sales_orders" views={views} selectedViewId={selectedViewId} onSelect={setSelectedViewId} />} />
      <InlineSavedViewFilters filterFields={definition?.filterFields ?? []} filters={activeFilters} onChange={(nextFilters) => setDraftConfig((current) => ({ ...current, filters: nextFilters }))} hideHeader />
      {error ? (
        <div role="alert" className="flex justify-between rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
          <span>We could not load orders.</span>
          <button onClick={refresh} className="underline underline-offset-2">Try again</button>
        </div>
      ) : null}
      <OrdersTable
        orders={orders}
        isLoading={isLoading}
        isRefreshing={isFetching && !isLoading}
        visibleColumns={visibleColumns}
        columnOptions={definition?.columns ?? []}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={clearFilters}
        sort={activeSort ? { column: activeSort.key, direction: activeSort.direction } : null}
        onSortChange={(nextSort) =>
          setDraftConfig((current) => ({
            ...current,
            sort: nextSort ? { key: nextSort.column, direction: nextSort.direction } : null,
          }))
        }
      />
      <Pagination page={page} totalPages={totalPages} totalCount={totalCount} rangeStart={rangeStart} rangeEnd={rangeEnd} pageSize={pageSize} isRefreshing={isFetching && !isLoading} onPageChange={goToPage} onPageSizeChange={onPageSizeChange} />
    </div>
  );
}
