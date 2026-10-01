"use client";

import {
  defaultStageKey,
  normalizeStageKey,
  selectableStages,
} from "@/components/opportunities/opportunityStages";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useOpportunityPipeline } from "@/hooks/sales/useOpportunityPipeline";

type Props = {
  id: string;
  /** The chosen stage key; empty means "the pipeline's default", which is what is shown. */
  value: string;
  onChange: (key: string) => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
  /** Lead conversion starts a deal in progress, so it leaves out the entry stage's peers. */
  filter?: (semanticType: string) => boolean;
};

/**
 * The one deal-stage picker for forms (04 frontend Phase 1).
 *
 * Options are the tenant's active stages in board order; a deactivated stage stays listed only
 * while it is the current value, so an existing deal still reads truthfully. An empty value
 * displays the pipeline default — the caller submits the same default through
 * `defaultStageKey`, so what is shown is what is saved.
 */
export function OpportunityStageSelect({
  id,
  value,
  onChange,
  disabled = false,
  required,
  className,
  ariaInvalid,
  ariaDescribedBy,
  filter,
}: Props) {
  const pipelineQuery = useOpportunityPipeline();
  const pipeline = pipelineQuery.data;
  const current = normalizeStageKey(value);
  const stages = selectableStages(pipeline, current).filter(
    (stage) => stage.key === current || !filter || filter(String(stage.semantic_type)),
  );
  const shown = current || defaultStageKey(pipeline);
  const unavailable = pipelineQuery.isError;

  return (
    <Select
      value={shown || undefined}
      onValueChange={onChange}
      disabled={disabled || !pipeline}
      required={required}
    >
      <SelectTrigger id={id} className={className} aria-invalid={ariaInvalid} aria-describedby={ariaDescribedBy}>
        <SelectValue placeholder={unavailable ? "Stages could not be loaded" : "Loading stages…"} />
      </SelectTrigger>
      <SelectContent>
        {stages.map((stage) => (
          <SelectItem key={stage.key} value={stage.key}>
            {stage.is_active ? stage.label : `${stage.label} (inactive)`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
