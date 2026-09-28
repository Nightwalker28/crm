/**
 * Deal stage presentation, driven by the tenant's pipeline (04-pipelines-kanban).
 *
 * Stages are configurable, so nothing here lists them. Order, labels and which stages can be
 * chosen come from `GET /sales/opportunities/pipeline` (`useOpportunityPipeline`); what a
 * stage *means* — open, ongoing, won, lost — comes from its `semantic_type`, never from its
 * label or key. A deal's own stage arrives on the record as `pipeline_stage`.
 */

import { formatSnakeCaseLabel } from "@/lib/module-display";
import type { StatusDescriptor, StatusTone } from "@/lib/statusStyles";

export type StageSemanticType = "open" | "ongoing" | "won" | "lost";

export type PipelineStage = {
  id: number;
  key: string;
  label: string;
  position: number;
  semantic_type: StageSemanticType | string;
  is_closed: boolean;
  probability: number;
  is_active: boolean;
};

export type OpportunityPipeline = {
  id: number;
  module_key: string;
  name: string;
  is_default: boolean;
  is_active: boolean;
  stages: PipelineStage[];
};

/** A deal's stage as the record carries it. */
export type OpportunityStageRef = {
  id: number;
  key: string;
  label: string;
  semantic_type: StageSemanticType | string;
  probability: number;
  is_active: boolean;
};

type StageLike = { key: string; label: string; semantic_type: string };

export const UNSTAGED_LABEL = "Unstaged";

/**
 * Colour marks the exception, not the state (rebuild R5): an outcome is coloured, a stage in
 * progress is not. Driven by meaning, so a renamed "Closed won" keeps its tone.
 */
export function stageTone(semanticType?: string | null): StatusTone {
  if (semanticType === "won") return "success";
  if (semanticType === "lost") return "critical";
  return "neutral";
}

export function isClosedSemantic(semanticType?: string | null) {
  return semanticType === "won" || semanticType === "lost";
}

export function normalizeStageKey(stage?: string | null) {
  return (stage ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

export function findStage(pipeline: OpportunityPipeline | undefined, key?: string | null) {
  const normalized = normalizeStageKey(key);
  if (!pipeline || !normalized) return undefined;
  return pipeline.stages.find((stage) => stage.key === normalized);
}

/**
 * A deal's stage for display: its own reference first, then the pipeline by key, then the key
 * itself in sentence case so a value never renders as a raw identifier.
 */
export function resolveStage(
  pipeline: OpportunityPipeline | undefined,
  key?: string | null,
  ref?: OpportunityStageRef | null,
): StageLike | null {
  if (ref) return ref;
  const normalized = normalizeStageKey(key);
  if (!normalized) return null;
  return findStage(pipeline, normalized) ?? { key: normalized, label: formatSnakeCaseLabel(normalized), semantic_type: "open" };
}

export function stageStatus(stage: StageLike | null | undefined): StatusDescriptor {
  if (!stage) return { tone: "neutral", label: UNSTAGED_LABEL };
  return { tone: stageTone(stage.semantic_type), label: stage.label };
}

/** Stages in board order. */
export function orderedStages(pipeline: OpportunityPipeline | undefined) {
  return [...(pipeline?.stages ?? [])].sort((a, b) => a.position - b.position || a.id - b.id);
}

/**
 * What a picker may offer: active stages, plus the current one when it has been deactivated,
 * so an existing deal still shows where it is but nothing new can be put there.
 */
export function selectableStages(pipeline: OpportunityPipeline | undefined, currentKey?: string | null) {
  const current = normalizeStageKey(currentKey);
  return orderedStages(pipeline).filter((stage) => stage.is_active || stage.key === current);
}

/** Where a new deal starts: the first active stage that is not an outcome. */
export function defaultStageKey(pipeline: OpportunityPipeline | undefined) {
  return orderedStages(pipeline).find((stage) => stage.is_active && !isClosedSemantic(stage.semantic_type))?.key ?? "";
}
