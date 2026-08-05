"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import CatalogRecordsTable from "@/components/catalog/CatalogRecordsTable";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import { ModuleListToolbar } from "@/components/ui/ModuleListToolbar";
import { Button } from "@/components/ui/button";
import Pagination from "@/components/ui/Pagination";
import { getConditionGroups } from "@/components/ui/SavedViewConditionEditor";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import type { CatalogKind, CatalogRecord, CatalogSortState } from "@/hooks/catalog/useCatalogRecords";
import { useCatalogRecords } from "@/hooks/catalog/useCatalogRecords";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useSavedViews } from "@/hooks/useSavedViews";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS, resolveSavedViewFilters, resolveVisibleColumns } from "@/lib/moduleViewConfigs";

type Props = {
  kind: CatalogKind;
};

export default function CatalogRecordsPage({ kind }: Props) {
  const router = useRouter();
  const isProduct = kind === "products";
  const lowerTitle = isProduct ? "products" : "services";
  const moduleKey = isProduct ? "catalog_products" : "catalog_services";
  const { modules } = useAccessibleModules();
  const moduleActions = modules.find((module) => module.name === moduleKey)?.actions;
  const canCreate = Boolean(moduleActions?.can_create);
  const canEdit = Boolean(moduleActions?.can_edit);
  const [togglingRecordId, setTogglingRecordId] = useState<number | null>(null);
  const { fields: moduleFields } = useModuleFieldConfigs(moduleKey);
  const definition = useMemo(() => buildModuleViewDefinition(moduleKey, [], moduleFields), [moduleKey, moduleFields]);
  const defaultConfig = definition?.defaultConfig ?? MODULE_VIEW_DEFAULTS[moduleKey];
  const {
    views,
    selectedViewId,
    setSelectedViewId,
    draftConfig,
    setDraftConfig,
  } = useSavedViews(moduleKey, defaultConfig);
  const defaultVisibleColumnsKey = JSON.stringify(defaultConfig.visible_columns);
  const defaultVisibleColumns = useMemo(() => JSON.parse(defaultVisibleColumnsKey) as string[], [defaultVisibleColumnsKey]);
  const visibleColumns = resolveVisibleColumns(definition, draftConfig, { ...defaultConfig, visible_columns: defaultVisibleColumns });
  const activeFilters = resolveSavedViewFilters(definition, draftConfig.filters);
  const activeSort = useMemo<CatalogSortState>(() => {
    const sort = draftConfig.sort;
    if (!sort || typeof sort.key !== "string") return null;
    return {
      key: sort.key,
      direction: sort.direction === "desc" ? "desc" : "asc",
    };
  }, [draftConfig.sort]);

  const {
    records,
    page,
    pageSize,
    totalPages,
    totalCount,
    rangeStart,
    rangeEnd,
    isLoading,
    isFetching,
    error,
    goToPage,
    onPageSizeChange,
    refresh,
    updateRecord,
  } = useCatalogRecords(kind, visibleColumns, activeFilters, activeSort);

  const searchValue = useMemo(() => (typeof activeFilters.search === "string" ? activeFilters.search : ""), [activeFilters.search]);
  const { allConditions, anyConditions } = getConditionGroups(activeFilters);
  const activeFilterCount = allConditions.length + anyConditions.length;
  const hasActiveFilters = Boolean(searchValue.trim() || activeFilterCount);

  function handleRowClick(record: CatalogRecord) {
    router.push(`/dashboard/catalog/${kind}/${record.id}`);
  }

  async function handleToggleActive(record: CatalogRecord, active: boolean) {
    if (!canEdit || togglingRecordId !== null) return;
    setTogglingRecordId(record.id);
    try {
      await updateRecord(record.id, {
        name: record.name,
        slug: record.slug ?? null,
        description: record.description ?? null,
        sku: record.sku ?? null,
        currency: record.currency,
        public_unit_price: Number(record.public_unit_price) || 0,
        stock_status: record.stock_status,
        stock_quantity: record.stock_quantity == null ? null : Number(record.stock_quantity),
        is_public: record.is_public,
        is_active: active,
      });
      toast.success(`${isProduct ? "Product" : "Service"} ${active ? "activated" : "deactivated"}.`);
    } catch {
      toast.error(`We could not ${active ? "activate" : "deactivate"} this ${isProduct ? "product" : "service"}. Try again.`);
    } finally {
      setTogglingRecordId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ModuleListToolbar
        searchValue={searchValue}
        onSearchChange={(search) => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search } }))}
        searchPlaceholder={`Search ${lowerTitle}`}
        filtersOpen={Boolean(activeFilters.filtersOpen)}
        activeFilterCount={activeFilterCount}
        onToggleFilters={() => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, filtersOpen: !current.filters.filtersOpen } }))}
        onClearFilters={() => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search: "", conditions: [], all_conditions: [], any_conditions: [] } }))}
        viewControls={<SavedViewSelector moduleKey={moduleKey} views={views} selectedViewId={selectedViewId} onSelect={setSelectedViewId} />}
        primaryAction={canCreate ? <Button asChild><Link href={`/dashboard/catalog/${kind}/new`}><Plus />New {isProduct ? "Product" : "Service"}</Link></Button> : undefined}
      />
      <InlineSavedViewFilters
        filterFields={definition?.filterFields ?? []}
        filters={activeFilters}
        onChange={(filters) => setDraftConfig((current) => ({ ...current, filters }))}
        hideHeader
      />

      {error ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
          <span>Catalog {lowerTitle} could not be loaded. Check your connection and try again.</span>
          <Button type="button" variant="outline" size="sm" onClick={refresh}>Retry</Button>
        </div>
      ) : null}

      <CatalogRecordsTable
        kind={kind}
        records={records}
        isLoading={isLoading}
        isRefreshing={isFetching && !isLoading}
        visibleColumns={visibleColumns}
        columnOptions={definition?.columns ?? []}
        sort={activeSort ? { column: activeSort.key, direction: activeSort.direction } : null}
        onSortChange={(nextSort) =>
          setDraftConfig((current) => ({
            ...current,
            sort: nextSort ? { key: nextSort.column, direction: nextSort.direction } : null,
          }))
        }
        onRowClick={handleRowClick}
        onToggleActive={canEdit ? handleToggleActive : undefined}
        togglingRecordId={togglingRecordId}
        hasActiveFilters={hasActiveFilters}
        canCreate={canCreate}
        onClearFilters={() =>
          setDraftConfig((current) => ({
            ...current,
            filters: { ...current.filters, search: "", conditions: [], all_conditions: [], any_conditions: [] },
          }))
        }
      />

      <Pagination
        page={page}
        totalPages={totalPages}
        totalCount={totalCount}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        pageSize={pageSize}
        isRefreshing={isFetching && !isLoading}
        onPageChange={goToPage}
        onPageSizeChange={onPageSizeChange}
      />
    </div>
  );
}
