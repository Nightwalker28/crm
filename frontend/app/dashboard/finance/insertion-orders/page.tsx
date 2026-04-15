"use client";

import { useState } from "react";
import { toast } from "sonner";

import InsertionOrdersList from "@/components/finance/insertionOrderList";
import InsertionOrderDialog from "@/components/finance/insertionOrderDialog";
import { useInsertionOrders } from "@/hooks/finance/useInsertionOrders";
import InsertionOrdersHeader from "../../../../components/finance/InsertionOrdersHeader";
import Pagination from "@/components/ui/Pagination";
import SearchBar from "@/components/ui/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { InsertionOrder, InsertionOrderPayload } from "@/hooks/finance/useInsertionOrders";
import { ColumnPicker } from "@/components/ui/ColumnPicker";
import { useTablePreferences } from "@/hooks/useTablePreferences";

const INSERTION_ORDER_COLUMNS = [
  { key: "io_number", label: "IO Number" },
  { key: "customer_name", label: "Customer" },
  { key: "status", label: "Status" },
  { key: "currency", label: "Currency" },
  { key: "total_amount", label: "Total" },
  { key: "issue_date", label: "Issue Date" },
  { key: "due_date", label: "Due Date" },
  { key: "external_reference", label: "Reference" },
  { key: "user_name", label: "Owner" },
  { key: "updated_at", label: "Updated" },
];

const DEFAULT_INSERTION_ORDER_COLUMNS = ["io_number", "customer_name", "status", "total_amount", "due_date"];

export default function InsertionOrdersPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<InsertionOrder | null>(null);
  const { visibleColumns, saveVisibleColumns } = useTablePreferences(
    "finance_io",
    INSERTION_ORDER_COLUMNS,
    DEFAULT_INSERTION_ORDER_COLUMNS,
  );
  const {
    orders,
    page,
    pageSize,
    totalPages,
    isLoading,
    error,
    goToPage,
    onPageSizeChange,
    refresh,
    totalCount,
    rangeStart,
    rangeEnd,
    searchTerm,
    setSearchTerm,
    statusFilter,
    setStatusFilter,
    createOrder,
    updateOrder,
    deleteOrder,
    isSaving,
    isDeleting,
  } = useInsertionOrders(visibleColumns, 1, 10);

  const handleCreateClick = () => {
    setSelectedOrder(null);
    setDialogOpen(true);
  };

  const handleEdit = (order: InsertionOrder) => {
    setSelectedOrder(order);
    setDialogOpen(true);
  };

  const handleDelete = async (order: InsertionOrder) => {
    const confirmed = window.confirm(`Move ${order.io_number} to the recycle state?`);
    if (!confirmed) return;

    try {
      await deleteOrder(order.id);
      toast.success("Insertion order moved out of the active list.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete insertion order");
    }
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
    <div className="bg-zinc-950">
      <div className="max-w-5xl mx-auto flex flex-col gap-6">
        <div className="flex items-start justify-between gap-4">
          <InsertionOrdersHeader
            onCreateClick={handleCreateClick}
            onUploadSuccess={refresh}
          />
          <ColumnPicker
            title="Insertion order columns"
            options={INSERTION_ORDER_COLUMNS}
            visibleColumns={visibleColumns}
            onChange={saveVisibleColumns}
          />
        </div>

        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex w-full flex-col gap-3 md:flex-row md:items-center">
            <SearchBar
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Search by customer, IO number, reference, or notes"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
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
          onEdit={handleEdit}
          onDelete={handleDelete}
          visibleColumns={visibleColumns}
        />

        <Pagination
          page={page}
          totalPages={totalPages}
          totalCount={totalCount}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          pageSize={pageSize}
          onPageChange={goToPage}
          onPageSizeChange={onPageSizeChange}
        />
      </div>

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
