"use client";

import { useState } from "react";
import { toast } from "sonner";

import OpportunityDialog from "@/components/opportunities/OpportunityDialog";
import OpportunitiesTable from "@/components/opportunities/OpportunitiesTable";
import SearchBar from "@/components/ui/SearchBar";
import Pagination from "@/components/ui/Pagination";
import { Button } from "@/components/ui/button";
import { ColumnPicker } from "@/components/ui/ColumnPicker";
import { useTablePreferences } from "@/hooks/useTablePreferences";
import { useOpportunities, type Opportunity, type OpportunityPayload } from "@/hooks/sales/useOpportunities";

const OPPORTUNITY_COLUMNS = [
  { key: "opportunity_name", label: "Opportunity" },
  { key: "client", label: "Client" },
  { key: "sales_stage", label: "Stage" },
  { key: "expected_close_date", label: "Expected Close" },
  { key: "total_cost_of_project", label: "Project Cost" },
  { key: "currency_type", label: "Currency" },
  { key: "created_time", label: "Created" },
];

const DEFAULT_OPPORTUNITY_COLUMNS = ["opportunity_name", "client", "sales_stage", "expected_close_date", "total_cost_of_project"];

export default function OpportunitiesPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedOpportunity, setSelectedOpportunity] = useState<Opportunity | null>(null);
  const { visibleColumns, saveVisibleColumns } = useTablePreferences(
    "sales_opportunities",
    OPPORTUNITY_COLUMNS,
    DEFAULT_OPPORTUNITY_COLUMNS,
  );
  const {
    opportunities,
    page,
    totalPages,
    totalCount,
    rangeStart,
    rangeEnd,
    isLoading,
    error,
    searchTerm,
    setSearchTerm,
    goToPage,
    createOpportunity,
    updateOpportunity,
    deleteOpportunity,
    createFinanceIo,
    isSaving,
    isDeleting,
  } = useOpportunities(visibleColumns);

  async function handleSubmit(payload: OpportunityPayload) {
    if (selectedOpportunity) {
      await updateOpportunity(selectedOpportunity.opportunity_id, payload);
      toast.success("Opportunity updated.");
      return;
    }
    await createOpportunity(payload);
    toast.success("Opportunity created.");
  }

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-100">Opportunities</h1>
          <p className="mt-1 text-sm text-neutral-400">Track pipeline, project value, and finance handoff.</p>
        </div>
        <div className="flex items-center gap-3">
          <ColumnPicker
            title="Opportunity columns"
            options={OPPORTUNITY_COLUMNS}
            visibleColumns={visibleColumns}
            onChange={saveVisibleColumns}
          />
          <Button
            onClick={() => {
              setSelectedOpportunity(null);
              setDialogOpen(true);
            }}
          >
            Add Opportunity
          </Button>
        </div>
      </div>

      <SearchBar value={searchTerm} onChange={setSearchTerm} placeholder="Search opportunities" />

      {error && <div className="rounded-lg border border-red-700 bg-red-900/40 px-4 py-3 text-sm text-red-200">{error}</div>}

      <OpportunitiesTable
        opportunities={opportunities}
        isLoading={isLoading}
        visibleColumns={visibleColumns}
        onEdit={(opportunity) => {
          setSelectedOpportunity(opportunity);
          setDialogOpen(true);
        }}
        onDelete={async (opportunity) => {
          if (!window.confirm(`Move ${opportunity.opportunity_name} to recycle bin?`)) return;
          await deleteOpportunity(opportunity.opportunity_id);
          toast.success("Opportunity moved to recycle bin.");
        }}
        onCreateFinanceIo={async (opportunity) => {
          await createFinanceIo(opportunity.opportunity_id);
          toast.success("Finance insertion order created.");
        }}
      />

      <Pagination
        page={page}
        totalPages={totalPages}
        totalCount={totalCount}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        pageSize={rangeStart && rangeEnd ? rangeEnd - rangeStart + 1 : 0}
        onPageChange={goToPage}
        onPageSizeChange={() => {}}
      />

      <OpportunityDialog
        open={dialogOpen}
        opportunity={selectedOpportunity}
        isSubmitting={isSaving || isDeleting}
        onClose={() => {
          setDialogOpen(false);
          setSelectedOpportunity(null);
        }}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
