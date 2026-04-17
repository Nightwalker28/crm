"use client";

import { useState } from "react";
import { toast } from "sonner";

import OpportunityDialog from "@/components/opportunities/OpportunityDialog";
import OpportunitiesTable from "@/components/opportunities/OpportunitiesTable";
import SearchBar from "@/components/ui/SearchBar";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import Pagination from "@/components/ui/Pagination";
import { Button } from "@/components/ui/button";
import { ModuleImportExportControls } from "@/components/ui/ModuleImportExportControls";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { useSavedViews } from "@/hooks/useSavedViews";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS } from "@/lib/moduleViewConfigs";
import { useOpportunities, type Opportunity, type OpportunityPayload } from "@/hooks/sales/useOpportunities";
import { useMemo } from "react";

export default function OpportunitiesPage() {
  const { data: customFields = [] } = useModuleCustomFields("sales_opportunities");
  const definition = useMemo(
    () => buildModuleViewDefinition("sales_opportunities", customFields),
    [customFields],
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedOpportunity, setSelectedOpportunity] = useState<Opportunity | null>(null);
  const {
    views,
    selectedViewId,
    setSelectedViewId,
    draftConfig,
    setDraftConfig,
  } = useSavedViews(
    "sales_opportunities",
    MODULE_VIEW_DEFAULTS.sales_opportunities,
  );
  const visibleColumns = draftConfig.visible_columns?.length ? draftConfig.visible_columns : MODULE_VIEW_DEFAULTS.sales_opportunities.visible_columns;
  const {
    opportunities,
    page,
    totalPages,
    totalCount,
    rangeStart,
    rangeEnd,
    isLoading,
    error,
    goToPage,
    createOpportunity,
    updateOpportunity,
    deleteOpportunity,
    createFinanceIo,
    isSaving,
    isDeleting,
  } = useOpportunities(visibleColumns, draftConfig.filters);

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
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-100">Opportunities</h1>
          <p className="mt-1 text-sm text-neutral-400">Track pipeline, project value, and finance handoff.</p>
        </div>
        <div className="flex items-center gap-3">
          <ModuleImportExportControls
            importEndpoint="/sales/opportunities/import"
            exportEndpoint="/sales/opportunities/export"
          />
          <SavedViewSelector
            moduleKey="sales_opportunities"
            views={views}
            selectedViewId={selectedViewId}
            onSelect={setSelectedViewId}
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
        placeholder="Search opportunities"
      />

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

      {error && <div className="rounded-lg border border-red-700 bg-red-900/40 px-4 py-3 text-sm text-red-200">{error}</div>}

      <OpportunitiesTable
        opportunities={opportunities}
        isLoading={isLoading}
        visibleColumns={visibleColumns}
        columnOptions={definition?.columns ?? []}
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
