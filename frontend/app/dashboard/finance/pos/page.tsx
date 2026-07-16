"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";

import InvoicesTable from "@/components/finance/pos/InvoicesTable";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import { ModuleListToolbar } from "@/components/ui/ModuleListToolbar";
import { PageHeader } from "@/components/ui/PageHeader";
import Pagination from "@/components/ui/Pagination";
import { getConditionGroups } from "@/components/ui/SavedViewConditionEditor";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useInvoiceList, type PosInvoiceSortState } from "@/hooks/finance/usePosInvoices";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useSavedViews } from "@/hooks/useSavedViews";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS, resolveSavedViewFilters, resolveVisibleColumns } from "@/lib/moduleViewConfigs";

export default function PosInvoicesPage() {
  const { fields: moduleFields } = useModuleFieldConfigs("finance_pos");
  const definition = useMemo(() => buildModuleViewDefinition("finance_pos", [], moduleFields), [moduleFields]);
  const defaultConfig = definition?.defaultConfig ?? MODULE_VIEW_DEFAULTS.finance_pos;
  const { views, selectedViewId, setSelectedViewId, draftConfig, setDraftConfig } = useSavedViews("finance_pos", defaultConfig);
  const activeFilters = resolveSavedViewFilters(definition, draftConfig.filters);
  const visibleColumns = resolveVisibleColumns(definition, draftConfig, defaultConfig);
  const sort = useMemo<PosInvoiceSortState>(() => draftConfig.sort && typeof draftConfig.sort.key === "string" ? { key: draftConfig.sort.key, direction: draftConfig.sort.direction === "desc" ? "desc" : "asc" } : null, [draftConfig.sort]);
  const { invoices, page, pageSize, totalPages, totalCount, rangeStart, rangeEnd, isLoading, isFetching, error, goToPage, onPageSizeChange, refresh } = useInvoiceList(activeFilters, sort);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const { allConditions, anyConditions } = getConditionGroups(activeFilters);
  const invoiceStatus = typeof activeFilters.status === "string" ? activeFilters.status : "all";
  const activeFilterCount = allConditions.length + anyConditions.length + (invoiceStatus === "all" ? 0 : 1);
  const hasActiveFilters = Boolean((typeof activeFilters.search === "string" && activeFilters.search.trim()) || activeFilterCount);
  const currentPageIds = invoices.map((invoice) => invoice.id);

  function clearFilters() {
    setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search: "", status: "all", conditions: [], all_conditions: [], any_conditions: [] } }));
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Invoices"
        description="Create itemized customer invoices, track payment status, and choose the print template per invoice."
        eyebrow={totalCount ? `${totalCount} invoice${totalCount === 1 ? "" : "s"} in this view` : undefined}
        actions={<Button asChild><Link href="/dashboard/finance/pos/new"><Plus />Create invoice</Link></Button>}
      />
      <ModuleListToolbar
        searchValue={typeof activeFilters.search === "string" ? activeFilters.search : ""}
        onSearchChange={(search) => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search } }))}
        searchPlaceholder="Search invoices by number, customer, payment, or notes"
        filtersOpen={Boolean(activeFilters.filtersOpen)}
        activeFilterCount={activeFilterCount}
        onToggleFilters={() => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, filtersOpen: !current.filters.filtersOpen } }))}
        onClearFilters={clearFilters}
        selectedCount={selectedIds.length}
        selectionNoun="invoice"
        onClearSelection={() => setSelectedIds([])}
        viewControls={<><SavedViewSelector moduleKey="finance_pos" views={views} selectedViewId={selectedViewId} onSelect={setSelectedViewId} /><Select value={invoiceStatus} onValueChange={(value) => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, status: value } }))}><SelectTrigger className="w-40" aria-label="Invoice status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="draft">Draft</SelectItem><SelectItem value="issued">Issued</SelectItem><SelectItem value="paid">Paid</SelectItem><SelectItem value="void">Void</SelectItem></SelectContent></Select></>}
      />
      <InlineSavedViewFilters filterFields={definition?.filterFields ?? []} filters={activeFilters} onChange={(filters) => setDraftConfig((current) => ({ ...current, filters }))} hideHeader />
      {error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary"><span>We could not load invoices. Check your connection and try again.</span><Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>Try again</Button></div> : null}
      <InvoicesTable invoices={invoices} visibleColumns={visibleColumns} isLoading={isLoading} isRefreshing={isFetching && !isLoading} selectedIds={selectedIds} sort={sort} hasActiveFilters={hasActiveFilters} onSortChange={(nextSort) => setDraftConfig((current) => ({ ...current, sort: nextSort }))} onToggle={(id, checked) => setSelectedIds((current) => checked ? Array.from(new Set([...current, id])) : current.filter((item) => item !== id))} onTogglePage={(checked) => setSelectedIds((current) => checked ? Array.from(new Set([...current, ...currentPageIds])) : current.filter((id) => !currentPageIds.includes(id)))} onClearFilters={clearFilters} />
      <Pagination page={page} totalPages={totalPages} totalCount={totalCount} rangeStart={rangeStart} rangeEnd={rangeEnd} pageSize={pageSize} isRefreshing={isFetching && !isLoading} onPageChange={goToPage} onPageSizeChange={onPageSizeChange} />
    </div>
  );
}
