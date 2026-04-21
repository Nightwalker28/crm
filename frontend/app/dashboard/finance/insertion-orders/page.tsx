"use client";

import { useState } from "react";
import { toast } from "sonner";

import InsertionOrdersList from "@/components/finance/insertionOrderList";
import InsertionOrderDialog from "@/components/finance/insertionOrderDialog";
import { useInsertionOrders } from "@/hooks/finance/useInsertionOrders";
import InsertionOrdersHeader from "../../../../components/finance/InsertionOrdersHeader";
import Pagination from "@/components/ui/Pagination";
import SearchBar from "@/components/ui/SearchBar";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { InsertionOrder, InsertionOrderPayload } from "@/hooks/finance/useInsertionOrders";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { useSavedViews } from "@/hooks/useSavedViews";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS } from "@/lib/moduleViewConfigs";
import { useMemo } from "react";

export default function InsertionOrdersPage() {
  const { data: customFields = [] } = useModuleCustomFields("finance_io");
  const definition = useMemo(
    () => buildModuleViewDefinition("finance_io", customFields),
    [customFields],
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<InsertionOrder | null>(null);
  const {
    views,
    selectedViewId,
    setSelectedViewId,
    draftConfig,
    setDraftConfig,
  } = useSavedViews(
    "finance_io",
    MODULE_VIEW_DEFAULTS.finance_io,
  );
  const visibleColumns = draftConfig.visible_columns?.length ? draftConfig.visible_columns : MODULE_VIEW_DEFAULTS.finance_io.visible_columns;
  const statusFilter = typeof draftConfig.filters?.status === "string" ? draftConfig.filters.status : "all";
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
    createOrder,
    updateOrder,
    isSaving,
    isDeleting,
  } = useInsertionOrders(visibleColumns, draftConfig.filters, 1, 10);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const currentPageIds = useMemo(() => orders.map((order) => order.id), [orders]);
  const currentPageSelectionState = useMemo<boolean | "indeterminate">(() => {
    if (!currentPageIds.length) return false;
    const selectedOnPage = currentPageIds.filter((id) => selectedIds.includes(id)).length;
    if (!selectedOnPage) return false;
    if (selectedOnPage === currentPageIds.length) return true;
    return "indeterminate";
  }, [currentPageIds, selectedIds]);

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

  const handleCreateClick = () => {
    setSelectedOrder(null);
    setDialogOpen(true);
  };

  const handleEdit = (order: InsertionOrder) => {
    setSelectedOrder(order);
    setDialogOpen(true);
  };

  const handleSubmit = async (payload: InsertionOrderPayload) => {
    if (selectedOrder) {
      await updateOrder(selectedOrder.id, payload);
      toast.success("Insertion order updated.");
      return;
    }

    await createOrder(payload);
    toast.success("Insertion order created.");
  };

  return (
    <div className="flex flex-col gap-6">
        <InsertionOrdersHeader
          onCreateClick={handleCreateClick}
          onUploadSuccess={refresh}
          selectedIds={selectedIds}
          currentPageIds={currentPageIds}
          viewSelector={
            <SavedViewSelector
            moduleKey="finance_io"
            views={views}
            selectedViewId={selectedViewId}
            onSelect={setSelectedViewId}
          />
          }
        />

        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex w-full flex-col gap-3 md:flex-row md:items-center">
            <SearchBar
              value={typeof draftConfig.filters?.search === "string" ? draftConfig.filters.search : ""}
              onChange={(value) =>
                setDraftConfig((current) => ({
                  ...current,
                  filters: {
                    ...current.filters,
                    search: value,
                  },
                }))
              }
              placeholder="Search by customer, IO number, reference, or notes"
            />
            <Select
              value={statusFilter}
              onValueChange={(value) =>
                setDraftConfig((current) => ({
                  ...current,
                  filters: {
                    ...current.filters,
                    status: value,
                  },
                }))
              }
            >
              <SelectTrigger className="w-full md:w-52">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="issued">Issued</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
                <SelectItem value="imported">Imported</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <InlineSavedViewFilters
          filterFields={definition?.filterFields ?? []}
          filters={draftConfig.filters}
          onChange={(nextFilters) =>
            setDraftConfig((current) => ({
              ...current,
              filters: nextFilters,
            }))
          }
        />

        {error && (
          <div className="bg-red-900/40 border border-red-700 text-red-200 text-sm rounded-lg px-4 py-3 flex items-center justify-between">
            <span>{error}</span>
            <button
              onClick={refresh}
              className="underline underline-offset-2 text-red-100 hover:text-red-50"
            >
              Retry
            </button>
          </div>
        )}

        <InsertionOrdersList
          orders={orders}
          isLoading={isLoading}
          isRefreshing={isFetching && !isLoading}
          onRowClick={handleEdit}
          visibleColumns={visibleColumns}
          columnOptions={definition?.columns ?? []}
          selectedIds={selectedIds}
          currentPageSelectionState={currentPageSelectionState}
          onToggleRow={toggleRow}
          onToggleCurrentPage={toggleCurrentPage}
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

      <InsertionOrderDialog
        open={dialogOpen}
        order={selectedOrder}
        isSubmitting={isSaving || isDeleting}
        onClose={() => {
          setDialogOpen(false);
          setSelectedOrder(null);
        }}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
