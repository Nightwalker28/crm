"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { FormSection } from "@/components/forms/RecordFormLayout";
import { AddPipelineStage } from "@/components/opportunities/AddPipelineStage";
import { PipelineStageRow } from "@/components/opportunities/PipelineStageRow";
import { orderedStages, type OpportunityPipeline } from "@/components/opportunities/opportunityStages";
import { PageShell } from "@/components/ui/PageShell";
import { SaveStateIndicator } from "@/components/ui/SaveStateIndicator";
import { SortableList } from "@/components/ui/SortableList";
import {
  OPPORTUNITY_PIPELINE_QUERY_KEY,
  PIPELINE_STAGE_USAGE_QUERY_KEY,
  createPipelineStage,
  reorderPipelineStages,
  updatePipelineStage,
  useOpportunityPipeline,
  usePipelineStageUsage,
  type PipelineStageChange,
} from "@/hooks/sales/useOpportunityPipeline";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useAutosave } from "@/hooks/useAutosave";
import { isForbiddenError } from "@/lib/api";
import { SETTINGS_ROUTES } from "@/lib/routes";

const MODULE_KEY = "sales_opportunities";

/**
 * The deal pipeline's stages (04-pipelines-kanban frontend Phase 2).
 *
 * A settings page of autosaving rows (R1): every control is one reversible field. Order is
 * board order and moves by button as well as by drag. What a stage *means* — its outcome and
 * probability — is set here and read everywhere else; its key never changes.
 *
 * A stage is added with an explicit button, never deleted — only deactivated, because deals
 * that sat in it must stay readable.
 */
export default function PipelineSettingsPage() {
  const queryClient = useQueryClient();
  const { modules, isLoading: isLoadingModules } = useAccessibleModules();
  const canConfigure = Boolean(modules.find((module) => module.name === MODULE_KEY)?.actions?.can_configure);
  const pipelineQuery = useOpportunityPipeline(canConfigure);
  const usageQuery = usePipelineStageUsage(canConfigure);
  const usageByStage = new Map((usageQuery.data?.stages ?? []).map((row) => [row.stage_id, row.live_deal_count]));

  const applySaved = useCallback(
    async (pipeline: OpportunityPipeline) => {
      queryClient.setQueryData(OPPORTUNITY_PIPELINE_QUERY_KEY, pipeline);
      // Deal lists, totals and records render stage labels and outcomes from these.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: PIPELINE_STAGE_USAGE_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ["sales-opportunities"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-opportunities-pipeline-summary"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-opportunity-summary"] }),
      ]);
    },
    [queryClient],
  );

  const addStage = useCallback(
    async (stage: { label: string; semantic_type: string }) => applySaved(await createPipelineStage(stage)),
    [applySaved],
  );

  const saveStage = useCallback(
    async (stageId: number, change: PipelineStageChange) => applySaved(await updatePipelineStage(stageId, change)),
    [applySaved],
  );

  const commitOrder = useCallback(
    async (stageIds: number[]) => {
      const previous = queryClient.getQueryData<OpportunityPipeline>(OPPORTUNITY_PIPELINE_QUERY_KEY);
      if (previous) {
        const positions = new Map(stageIds.map((id, index) => [id, index]));
        queryClient.setQueryData<OpportunityPipeline>(OPPORTUNITY_PIPELINE_QUERY_KEY, {
          ...previous,
          stages: previous.stages.map((stage) => ({ ...stage, position: positions.get(stage.id) ?? stage.position })),
        });
      }
      try {
        await applySaved(await reorderPipelineStages(stageIds));
      } catch (error) {
        if (previous) queryClient.setQueryData(OPPORTUNITY_PIPELINE_QUERY_KEY, previous);
        await queryClient.invalidateQueries({ queryKey: OPPORTUNITY_PIPELINE_QUERY_KEY });
        throw error;
      }
    },
    [applySaved, queryClient],
  );
  const order = useAutosave(commitOrder);

  const stages = orderedStages(pipelineQuery.data);
  const isForbidden = (!isLoadingModules && !canConfigure) || isForbiddenError(pipelineQuery.error);
  const isPending = isLoadingModules || (canConfigure && pipelineQuery.isPending);

  return (
    <PageShell
      variant="settings"
      title="Deal pipeline"
      description="Name, order and weight the stages deals move through."
      isPermissionDenied={isForbidden}
      isLoading={isPending}
      hasError={!isForbidden && !isPending && Boolean(pipelineQuery.error)}
      errorDescription="Nothing has been changed. Try the request again."
      onRetry={() => void pipelineQuery.refetch()}
      backHref={SETTINGS_ROUTES.root}
      backLabel="Back to settings"
    >
      <FormSection
        title="Stages"
        description="The order here is the board's column order. The outcome decides what counts as won or lost in reports and automations; the probability weights the forecast when a deal has none of its own."
        action={<SaveStateIndicator state={order.state} onRetry={order.retry} />}
      >
        <SortableList
          label="Pipeline stages"
          className="divide-y divide-line-subtle rounded-[var(--radius-control)] border border-line-default"
          items={stages}
          getKey={(stage) => String(stage.id)}
          getItemLabel={(stage) => stage.label}
          // Not `disabled` while saving: a disabled list drops its move buttons, and the one the
          // operator just pressed would take focus with it. A move during a save is ignored.
          onMove={(from, to) => {
            if (order.isSaving) return;
            const ids = stages.map((stage) => stage.id);
            const [moved] = ids.splice(from, 1);
            ids.splice(to, 0, moved);
            void order.save(ids);
          }}
          renderItem={(stage, { handle, moveButtons }) => (
            <PipelineStageRow
              stage={stage}
              liveDealCount={usageByStage.get(stage.id)}
              handle={handle}
              moveButtons={moveButtons}
              onSave={saveStage}
            />
          )}
        />
        <AddPipelineStage onAdd={addStage} />
      </FormSection>
    </PageShell>
  );
}
