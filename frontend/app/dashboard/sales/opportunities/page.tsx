"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import OpportunityDialog from "@/components/opportunities/OpportunityDialog";
import OpportunitiesPipelineBoard from "@/components/opportunities/OpportunitiesPipelineBoard";
import OpportunitiesTable from "@/components/opportunities/OpportunitiesTable";
import SearchBar from "@/components/ui/SearchBar";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import Pagination from "@/components/ui/Pagination";
import { Button } from "@/components/ui/button";
import { ModuleImportExportControls } from "@/components/ui/ModuleImportExportControls";
import { buildSavedViewExportPayload } from "@/lib/savedViewQuery";
import { PageHeader } from "@/components/ui/PageHeader";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { useSavedViews } from "@/hooks/useSavedViews";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { apiFetch } from "@/lib/api";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS } from "@/lib/moduleViewConfigs";
import { useOpportunities, type Opportunity, type OpportunityPayload } from "@/hooks/sales/useOpportunities";
import { useMemo } from "react";
import { Columns3, Plus, Table2 } from "lucide-react";

type OpportunityPipelineSummaryResponse = {
  total_count: number;
  stages: Array<{
    stage_key: string;
    label: string;
    count: number;
    total_value: number;
  }>;
};

const DEFAULT_STAGE_SUMMARY: OpportunityPipelineSummaryResponse["stages"] = [
  { stage_key: "lead", label: "Lead", count: 0, total_value: 0 },
  { stage_key: "qualified", label: "Qualified", count: 0, total_value: 0 },
  { stage_key: "proposal", label: "Proposal", count: 0, total_value: 0 },
  { stage_key: "negotiation", label: "Negotiation", count: 0, total_value: 0 },
  { stage_key: "closed_won", label: "Closed Won", count: 0, total_value: 0 },
  { stage_key: "closed_lost", label: "Closed Lost", count: 0, total_value: 0 },
  { stage_key: "unstaged", label: "Unstaged", count: 0, total_value: 0 },
];

async function fetchPipelineSummary(filters: unknown) {
  const params = new URLSearchParams();
  if (filters && typeof filters === "object") {
    const typedFilters = filters as Record<string, unknown>;
    if (typeof typedFilters.search === "string" && typedFilters.search.trim()) {
      params.set("query", typedFilters.search.trim());
    }
    if (Array.isArray(typedFilters.all_conditions) && typedFilters.all_conditions.length) {
      params.set("filters_all", JSON.stringify(typedFilters.all_conditions));
    }
    if (Array.isArray(typedFilters.any_conditions) && typedFilters.any_conditions.length) {
      params.set("filters_any", JSON.stringify(typedFilters.any_conditions));
    }
  }
  const res = await apiFetch(`/sales/opportunities/pipeline-summary?${params.toString()}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to load opportunity pipeline summary.");
  }
  return body as OpportunityPipelineSummaryResponse;
}

export default function OpportunitiesPage() {
  const router = useRouter();
  const { data: customFields = [] } = useModuleCustomFields("sales_opportunities");
  const definition = useMemo(
    () => buildModuleViewDefinition("sales_opportunities", customFields),
    [customFields],
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedOpportunity, setSelectedOpportunity] = useState<Opportunity | null>(null);
  const [displayMode, setDisplayMode] = useState<"table" | "pipeline">("table");
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
  const pipelineSummaryQuery = useQuery({
    queryKey: ["sales-opportunities-pipeline-summary", draftConfig.filters],
    queryFn: () => fetchPipelineSummary(draftConfig.filters),
    staleTime: 30000,
  });
  const {
    opportunities,
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
    createOpportunity,
    updateOpportunity,
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

  const stageSummary = pipelineSummaryQuery.data?.stages ?? DEFAULT_STAGE_SUMMARY;

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
              exportBody={buildSavedViewExportPayload(draftConfig.filters)}
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

      <div className="grid gap-3 xl:grid-cols-[1fr_auto]">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
          {stageSummary.map((item) => (
            <div
              key={item.stage_key}
              className="rounded-lg border border-neutral-800 bg-neutral-950/60 px-4 py-4"
            >
              <div className="text-xs uppercase tracking-[0.16em] text-neutral-500">{item.label}</div>
              <div className="mt-2 text-2xl font-semibold text-neutral-100">
                {pipelineSummaryQuery.isLoading ? "—" : item.count}
              </div>
              <div className="mt-1 text-sm text-neutral-400">
                {item.total_value > 0
                  ? `${new Intl.NumberFormat("en-US", {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 0,
                    }).format(item.total_value)} loaded`
                  : pipelineSummaryQuery.isLoading
                    ? "Loading…"
                    : "No value loaded"}
              </div>
            </div>
          ))}
        </div>

        <div className="inline-flex h-fit items-center rounded-lg border border-neutral-800 bg-neutral-950/60 p-1">
          <button
            type="button"
            onClick={() => setDisplayMode("table")}
            className={
              "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors " +
              (displayMode === "table"
                ? "bg-white/10 text-neutral-100"
                : "text-neutral-400 hover:text-neutral-100")
            }
          >
            <Table2 className="h-4 w-4" />
            Table
          </button>
          <button
            type="button"
            onClick={() => setDisplayMode("pipeline")}
            className={
              "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors " +
              (displayMode === "pipeline"
                ? "bg-white/10 text-neutral-100"
                : "text-neutral-400 hover:text-neutral-100")
            }
          >
            <Columns3 className="h-4 w-4" />
            Pipeline
          </button>
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
        <div className="rounded-lg border border-red-700 bg-red-900/40 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {displayMode === "table" ? (
        <OpportunitiesTable
          opportunities={opportunities}
          isLoading={isLoading}
          isRefreshing={isFetching && !isLoading}
          visibleColumns={visibleColumns}
          columnOptions={definition?.columns ?? []}
          selectedIds={selectedIds}
          currentPageSelectionState={currentPageSelectionState}
          onToggleRow={toggleRow}
          onToggleCurrentPage={toggleCurrentPage}
          onEdit={(opportunity) => {
            router.push(`/dashboard/sales/opportunities/${opportunity.opportunity_id}`);
          }}
          onCreateFinanceIo={async (opportunity) => {
            await createFinanceIo(opportunity.opportunity_id);
            toast.success("Finance insertion order created.");
          }}
        />
      ) : (
        <OpportunitiesPipelineBoard
          opportunities={opportunities}
          isLoading={isLoading}
          isRefreshing={isFetching && !isLoading}
          onEdit={(opportunity) => {
            router.push(`/dashboard/sales/opportunities/${opportunity.opportunity_id}`);
          }}
          onCreateFinanceIo={async (opportunity) => {
            await createFinanceIo(opportunity.opportunity_id);
            toast.success("Finance insertion order created.");
          }}
        />
      )}

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
