"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CreditCard, ReceiptText } from "lucide-react";
import { toast } from "sonner";

import RecordPaymentDialog from "@/components/finance/payments/RecordPaymentDialog";
import PaymentsTable from "@/components/finance/payments/PaymentsTable";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import { ModuleListToolbar } from "@/components/ui/ModuleListToolbar";
import { PageShell } from "@/components/ui/PageShell";
import Pagination from "@/components/ui/Pagination";
import { getConditionGroups } from "@/components/ui/SavedViewConditionEditor";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePaymentInvoices, type PosInvoice, type PosInvoiceSortState, type RecordPaymentPayload } from "@/hooks/finance/usePosInvoices";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useSavedViews } from "@/hooks/useSavedViews";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS, resolveSavedViewFilters, resolveVisibleColumns } from "@/lib/moduleViewConfigs";

export default function PaymentsPage() {
  const { modules } = useAccessibleModules();
  const invoiceActions = modules.find((module) => module.name === "finance_pos")?.actions;
  const canCreateInvoice = Boolean(invoiceActions?.can_create);
  const canRecordPayment = Boolean(invoiceActions?.can_edit);
  const { fields: moduleFields } = useModuleFieldConfigs("finance_pos");
  const definition = useMemo(() => buildModuleViewDefinition("finance_payments", [], moduleFields), [moduleFields]);
  const defaultConfig = definition?.defaultConfig ?? MODULE_VIEW_DEFAULTS.finance_payments;
  const { views, selectedViewId, setSelectedViewId, draftConfig, setDraftConfig } = useSavedViews("finance_payments", defaultConfig);
  const activeFilters = resolveSavedViewFilters(definition, draftConfig.filters);
  const visibleColumns = resolveVisibleColumns(definition, draftConfig, defaultConfig);
  const sort = useMemo<PosInvoiceSortState>(() => draftConfig.sort && typeof draftConfig.sort.key === "string" ? { key: draftConfig.sort.key, direction: draftConfig.sort.direction === "desc" ? "desc" : "asc" } : null, [draftConfig.sort]);
  const { invoices, page, pageSize, totalPages, totalCount, rangeStart, rangeEnd, isLoading, isFetching, error, goToPage, onPageSizeChange, refresh, recordPayment, isRecordingPayment } = usePaymentInvoices(activeFilters, sort);
  const [paymentInvoice, setPaymentInvoice] = useState<PosInvoice | null>(null);
  const { allConditions, anyConditions } = getConditionGroups(activeFilters);
  const paymentStatus = typeof activeFilters.payment_status === "string" ? activeFilters.payment_status : "all";
  const activeFilterCount = allConditions.length + anyConditions.length + (paymentStatus === "all" ? 0 : 1);
  const hasActiveFilters = Boolean((typeof activeFilters.search === "string" && activeFilters.search.trim()) || activeFilterCount);

  function clearFilters() {
    setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search: "", payment_status: "all", conditions: [], all_conditions: [], any_conditions: [] } }));
  }

  async function submitPayment(payload: RecordPaymentPayload) {
    if (!paymentInvoice) return;
    await recordPayment(paymentInvoice.id, payload);
    toast.success("Payment recorded.");
  }

  return (
    <PageShell variant="list" title="Payments">
      <ModuleListToolbar
        searchValue={typeof activeFilters.search === "string" ? activeFilters.search : ""}
        onSearchChange={(search) => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search } }))}
        searchPlaceholder="Search payments by invoice, customer, method, or status"
        filtersOpen={Boolean(activeFilters.filtersOpen)}
        activeFilterCount={activeFilterCount}
        onToggleFilters={() => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, filtersOpen: !current.filters.filtersOpen } }))}
        columnOptions={definition?.columns ?? []}
        visibleColumns={visibleColumns}
        onVisibleColumnsChange={(nextColumns) => setDraftConfig((current) => ({ ...current, visible_columns: nextColumns }))}
        onClearFilters={clearFilters}
        viewControls={<><SavedViewSelector moduleKey="finance_payments" views={views} selectedViewId={selectedViewId} onSelect={setSelectedViewId} /><Select value={paymentStatus} onValueChange={(value) => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, payment_status: value } }))}><SelectTrigger className="w-40" aria-label="Payment status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All payments</SelectItem><SelectItem value="unpaid">Unpaid</SelectItem><SelectItem value="partial">Partially paid</SelectItem><SelectItem value="paid">Paid</SelectItem><SelectItem value="refunded">Refunded</SelectItem></SelectContent></Select></>}
        /*
          A7 — the header button was the slower of two paths and wore the primary fill that
          says otherwise. From this list the fast path is the row's own Record payment
          button, against an invoice already on screen; the standalone page makes you search
          for the invoice you were just looking at. The standalone path keeps its entry — it
          is the one that works when the invoice is not in this view — as an outline control,
          under the same name, because an action keeps its name for the whole flow (7.4).
          The list has no primary action now: its verbs are per row (2.2, R4).
        */
        actionControls={<><Button asChild variant="outline" size="sm"><Link href="/dashboard/finance/pos"><ReceiptText />Open invoices</Link></Button>{canRecordPayment ? <Button asChild variant="outline" size="sm"><Link href="/dashboard/finance/payments/record"><CreditCard />Record payment</Link></Button> : null}</>}
      />
      <InlineSavedViewFilters filterFields={definition?.filterFields ?? []} filters={activeFilters} onChange={(filters) => setDraftConfig((current) => ({ ...current, filters }))} hideHeader />
      <PaymentsTable invoices={invoices} visibleColumns={visibleColumns} isLoading={isLoading} isRefreshing={isFetching && !isLoading} sort={sort} hasActiveFilters={hasActiveFilters} hasError={Boolean(error)} onRetry={() => void refresh()} canCreateInvoice={canCreateInvoice} canRecordPayment={canRecordPayment} onSortChange={(nextSort) => setDraftConfig((current) => ({ ...current, sort: nextSort }))} onRecordPayment={setPaymentInvoice} onClearFilters={clearFilters} />
      <Pagination page={page} totalPages={totalPages} totalCount={totalCount} rangeStart={rangeStart} rangeEnd={rangeEnd} pageSize={pageSize} isRefreshing={isFetching && !isLoading} onPageChange={goToPage} onPageSizeChange={onPageSizeChange} />
      <RecordPaymentDialog key={paymentInvoice?.id ?? "closed"} open={Boolean(paymentInvoice)} invoice={paymentInvoice} isSubmitting={isRecordingPayment} onClose={() => setPaymentInvoice(null)} onSubmit={submitPayment} />
    </PageShell>
  );
}
