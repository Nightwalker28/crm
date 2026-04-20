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
import { PageHeader } from "@/components/ui/PageHeader";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { useSavedViews } from "@/hooks/useSavedViews";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS } from "@/lib/moduleViewConfigs";
import { useOpportunities, type Opportunity, type OpportunityPayload } from "@/hooks/sales/useOpportunities";
import { useMemo } from "react";
import { Plus } from "lucide-react";

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
    pageSize,
    totalPages,
    totalCount,
    rangeStart,
    rangeEnd,
    isLoading,
    error,
    goToPage,
    onPageSizeChange,
    createOpportunity,
    updateOpportunity,
    deleteOpportunity,
    createFinanceIo,
    isSaving,
    isDeleting,
  } = useOpportunities(visibleColumns, draftConfig.filters);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const currentPageIds = useMemo(() => opportunities.map((opportunity) => opportunity.opportunity_id), [opportunities]);
  const currentPageSelectionState = useMemo<boolean | "indeterminate">(() => {
    if (!currentPageIds.length) return false;
    const selectedOnPage = currentPageIds.filter((id) => selectedIds.includes(id)).length;
    if (!selectedOnPage) return false;
    if (selectedOnPage === currentPageIds.length) return true;
    return "indeterminate";
  }, [currentPageIds, selectedIds]);

  function toggleRow(opportunityId: number, checked: boolean) {
    setSelectedIds((current) =>
      checked ? Array.from(new Set([...current, opportunityId])) : current.filter((id) => id !== opportunityId),
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
      <PageHeader
        title="Opportunities"
        description="Track pipeline, project value, and finance handoff."
        actions={
          <>
            {/* 1. View selector */}
            <SavedViewSelector
              moduleKey="sales_opportunities"
              views={views}
              selectedViewId={selectedViewId}
              onSelect={setSelectedViewId}
            />
            {/* 2. Import/export actions */}
            <ModuleImportExportControls
              importEndpoint="/sales/opportunities/import"
              exportEndpoint="/sales/opportunities/export"
              exportMethod="POST"
              selectedIds={selectedIds}
              currentPageIds={currentPageIds}
            />
            {/* 3. Primary create action */}
            <Button
              onClick={() => {
                setSelectedOpportunity(null);
                setDialogOpen(true);
              }}
            >
              <Plus />
              <span className="hidden sm:inline">Add Opportunity</span>
            </Button>
          </>
        }
      />

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

      {error && (
        <div className="rounded-lg border border-red-700 bg-red-900/40 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <OpportunitiesTable
        opportunities={opportunities}
        isLoading={isLoading}
        visibleColumns={visibleColumns}
        columnOptions={definition?.columns ?? []}
        selectedIds={selectedIds}
        currentPageSelectionState={currentPageSelectionState}
        onToggleRow={toggleRow}
        onToggleCurrentPage={toggleCurrentPage}
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
        pageSize={pageSize}
        onPageChange={goToPage}
        onPageSizeChange={onPageSizeChange}
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
