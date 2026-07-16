"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ReceiptText } from "lucide-react";
import { toast } from "sonner";

import RecordPaymentDialog from "@/components/finance/payments/RecordPaymentDialog";
import PaymentsTable from "@/components/finance/payments/PaymentsTable";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import { ModuleListToolbar } from "@/components/ui/ModuleListToolbar";
import { PageHeader } from "@/components/ui/PageHeader";
import Pagination from "@/components/ui/Pagination";
import { getConditionGroups } from "@/components/ui/SavedViewConditionEditor";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePaymentInvoices, type PosInvoice, type PosInvoiceSortState, type RecordPaymentPayload } from "@/hooks/finance/usePosInvoices";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useSavedViews } from "@/hooks/useSavedViews";
import type { SavedViewConfig } from "@/hooks/useSavedViews";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS, resolveSavedViewFilters, resolveVisibleColumns } from "@/lib/moduleViewConfigs";

const PAYMENT_DEFAULT_CONFIG: SavedViewConfig = {
  visible_columns: ["invoice_number", "customer_name", "payment_status", "total_amount", "amount_paid", "balance_due", "due_date", "payment_method", "updated_at"],
  filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [], payment_status: "all", filtersOpen: false },
  sort: { key: "due_date", direction: "asc" },
};

export default function PaymentsPage() {
  const { fields: moduleFields } = useModuleFieldConfigs("finance_pos");
  const definition = useMemo(() => buildModuleViewDefinition("finance_pos", [], moduleFields), [moduleFields]);
  const defaultConfig = definition ? PAYMENT_DEFAULT_CONFIG : MODULE_VIEW_DEFAULTS.finance_pos;
  const { views, selectedViewId, setSelectedViewId, draftConfig, setDraftConfig } = useSavedViews("finance_pos", defaultConfig);
  const activeFilters = resolveSavedViewFilters(definition, draftConfig.filters);
  const visibleColumns = resolveVisibleColumns(definition, draftConfig, defaultConfig);
  const sort = useMemo<PosInvoiceSortState>(() => draftConfig.sort && typeof draftConfig.sort.key === "string" ? { key: draftConfig.sort.key, direction: draftConfig.sort.direction === "desc" ? "desc" : "asc" } : null, [draftConfig.sort]);
  const { invoices, page, pageSize, totalPages, totalCount, rangeStart, rangeEnd, isLoading, isFetching, error, goToPage, onPageSizeChange, refresh, recordPayment, isRecordingPayment } = usePaymentInvoices(activeFilters, sort);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [paymentInvoice, setPaymentInvoice] = useState<PosInvoice | null>(null);
  const { allConditions, anyConditions } = getConditionGroups(activeFilters);
  const paymentStatus = typeof activeFilters.payment_status === "string" ? activeFilters.payment_status : "all";
  const activeFilterCount = allConditions.length + anyConditions.length + (paymentStatus === "all" ? 0 : 1);
  const hasActiveFilters = Boolean((typeof activeFilters.search === "string" && activeFilters.search.trim()) || activeFilterCount);
  const selectedInvoice = selectedIds.length === 1 ? invoices.find((invoice) => invoice.id === selectedIds[0]) ?? null : null;
  const currentPageIds = invoices.map((invoice) => invoice.id);

  function clearFilters() {
    setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search: "", payment_status: "all", conditions: [], all_conditions: [], any_conditions: [] } }));
  }

  async function submitPayment(payload: RecordPaymentPayload) {
    if (!paymentInvoice) return;
    await recordPayment(paymentInvoice.id, payload);
    setSelectedIds((current) => current.filter((id) => id !== paymentInvoice.id));
    toast.success("Payment recorded.");
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Payments" description="Track invoice balances and record customer payments without leaving the receivables workflow." eyebrow={totalCount ? `${totalCount} invoice${totalCount === 1 ? "" : "s"} in this view` : undefined} actions={<Button asChild variant="outline"><Link href="/dashboard/finance/pos"><ReceiptText />Open invoices</Link></Button>} />
      <ModuleListToolbar
        searchValue={typeof activeFilters.search === "string" ? activeFilters.search : ""}
        onSearchChange={(search) => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search } }))}
        searchPlaceholder="Search payments by invoice, customer, method, or status"
        filtersOpen={Boolean(activeFilters.filtersOpen)}
        activeFilterCount={activeFilterCount}
        onToggleFilters={() => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, filtersOpen: !current.filters.filtersOpen } }))}
        onClearFilters={clearFilters}
        selectedCount={selectedIds.length}
        selectionNoun="invoice"
        onClearSelection={() => setSelectedIds([])}
        viewControls={<><SavedViewSelector moduleKey="finance_pos" views={views} selectedViewId={selectedViewId} onSelect={setSelectedViewId} /><Select value={paymentStatus} onValueChange={(value) => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, payment_status: value } }))}><SelectTrigger className="w-40" aria-label="Payment status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All payments</SelectItem><SelectItem value="unpaid">Unpaid</SelectItem><SelectItem value="partial">Partially paid</SelectItem><SelectItem value="paid">Paid</SelectItem><SelectItem value="refunded">Refunded</SelectItem></SelectContent></Select></>}
        actionControls={selectedInvoice ? <Button type="button" size="sm" disabled={selectedInvoice.balance_due <= 0 || selectedInvoice.status === "void" || selectedInvoice.payment_status === "refunded"} onClick={() => setPaymentInvoice(selectedInvoice)}>Record selected payment</Button> : selectedIds.length > 1 ? <span className="text-xs text-copy-muted">Select one invoice to record a payment</span> : null}
      />
      <InlineSavedViewFilters filterFields={definition?.filterFields ?? []} filters={activeFilters} onChange={(filters) => setDraftConfig((current) => ({ ...current, filters }))} hideHeader />
      {error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary"><span>We could not load payments. Check your connection and try again.</span><Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>Try again</Button></div> : null}
      <PaymentsTable invoices={invoices} visibleColumns={visibleColumns} isLoading={isLoading} isRefreshing={isFetching && !isLoading} selectedIds={selectedIds} sort={sort} hasActiveFilters={hasActiveFilters} onSortChange={(nextSort) => setDraftConfig((current) => ({ ...current, sort: nextSort }))} onToggle={(id, checked) => setSelectedIds((current) => checked ? Array.from(new Set([...current, id])) : current.filter((item) => item !== id))} onTogglePage={(checked) => setSelectedIds((current) => checked ? Array.from(new Set([...current, ...currentPageIds])) : current.filter((id) => !currentPageIds.includes(id)))} onRecordPayment={setPaymentInvoice} onClearFilters={clearFilters} />
      <Pagination page={page} totalPages={totalPages} totalCount={totalCount} rangeStart={rangeStart} rangeEnd={rangeEnd} pageSize={pageSize} isRefreshing={isFetching && !isLoading} onPageChange={goToPage} onPageSizeChange={onPageSizeChange} />
      <RecordPaymentDialog key={paymentInvoice?.id ?? "closed"} open={Boolean(paymentInvoice)} invoice={paymentInvoice} isSubmitting={isRecordingPayment} onClose={() => setPaymentInvoice(null)} onSubmit={submitPayment} />
    </div>
  );
}
