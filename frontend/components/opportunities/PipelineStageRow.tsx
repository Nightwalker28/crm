"use client";

import { useCallback, useState, type ReactNode } from "react";

import type { PipelineStage } from "@/components/opportunities/opportunityStages";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SaveStateIndicator } from "@/components/ui/SaveStateIndicator";
import { SegmentedBoolean } from "@/components/ui/SegmentedControl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAutosave } from "@/hooks/useAutosave";
import { useConfirm } from "@/hooks/useConfirm";
import { PipelineSettingsError, type PipelineStageChange } from "@/hooks/sales/useOpportunityPipeline";

/** What a stage means to reports, the forecast, automations and the deal record. */
const OUTCOMES = [
  { value: "open", label: "Open" },
  { value: "ongoing", label: "In progress" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

type Props = {
  stage: PipelineStage;
  liveDealCount: number | undefined;
  handle: ReactNode;
  moveButtons: ReactNode;
  onSave: (stageId: number, change: PipelineStageChange) => Promise<unknown>;
};

/**
 * One stage of the deal pipeline, as a settings row (design.md §4.7 archetype 4).
 *
 * Each control is one independent, reversible field, so each autosaves (R1) and the row's
 * `SaveStateIndicator` reports it. The name and probability are typed, so they commit on
 * blur or Enter rather than per keystroke. The stable key is shown and never editable:
 * saved views, automations and imports refer to it.
 */
export function PipelineStageRow({ stage, liveDealCount, handle, moveButtons, onSave }: Props) {
  const { confirm } = useConfirm();
  const [label, setLabel] = useState(stage.label);
  const [probability, setProbability] = useState(String(stage.probability));
  const [message, setMessage] = useState<string | null>(null);

  const commit = useCallback(
    async (change: PipelineStageChange) => {
      setMessage(null);
      try {
        await onSave(stage.id, change);
      } catch (error) {
        setMessage(error instanceof PipelineSettingsError ? error.message : "The change could not be saved. Try again.");
        throw error;
      }
    },
    [onSave, stage.id],
  );
  const autosave = useAutosave(commit);

  function commitLabel() {
    const next = label.trim();
    if (next === stage.label) return;
    if (!next) {
      setLabel(stage.label);
      return;
    }
    void autosave.save({ label: next });
  }

  function commitProbability() {
    const next = Number(probability);
    if (probability.trim() === "" || Number.isNaN(next)) {
      setProbability(String(stage.probability));
      return;
    }
    if (next === stage.probability) return;
    void autosave.save({ probability: next });
  }

  async function changeActive(isActive: boolean) {
    if (!isActive && liveDealCount) {
      const confirmed = await confirm({
        title: `Deactivate ${stage.label}?`,
        description: `${liveDealCount} ${liveDealCount === 1 ? "deal is" : "deals are"} in this stage. ${liveDealCount === 1 ? "It stays" : "They stay"} there and keep reporting as before, but no deal can be moved into it until it is active again.`,
        confirmLabel: "Deactivate stage",
      });
      if (!confirmed) return;
    }
    void autosave.save({ is_active: isActive });
  }

  const nameId = `pipeline-stage-${stage.id}-name`;
  const messageId = `pipeline-stage-${stage.id}-message`;

  return (
    <div data-testid={`pipeline-stage-${stage.key}`} className="flex flex-col gap-3 px-3 py-3 lg:flex-row lg:flex-wrap lg:items-center">
      <div className="flex min-w-0 items-center gap-2 lg:w-64">
        {handle}
        <div className="min-w-0 flex-1">
          <Input
            id={nameId}
            aria-label={`${stage.label} name`}
            aria-describedby={message ? messageId : undefined}
            aria-invalid={Boolean(message)}
            value={label}
            maxLength={80}
            onChange={(event) => setLabel(event.target.value)}
            onBlur={commitLabel}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
          <p className="mt-1 truncate text-p-xs text-copy-muted">
            Key {stage.key}
            {liveDealCount !== undefined ? ` · ${liveDealCount} ${liveDealCount === 1 ? "deal" : "deals"}` : ""}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Select value={String(stage.semantic_type)} onValueChange={(semantic_type) => void autosave.save({ semantic_type })}>
          <SelectTrigger className="w-36" aria-label={`${stage.label} outcome`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OUTCOMES.map((outcome) => (
              <SelectItem key={outcome.value} value={outcome.value}>{outcome.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          <Input
            className="w-20 text-right tabular-nums"
            type="number"
            min={0}
            max={100}
            step={1}
            inputMode="numeric"
            aria-label={`${stage.label} probability, percent`}
            value={probability}
            onChange={(event) => setProbability(event.target.value)}
            onBlur={commitProbability}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
          <span className="text-sm text-copy-muted" aria-hidden="true">%</span>
        </div>
        <SegmentedBoolean
          aria-label={`${stage.label} availability`}
          value={stage.is_active}
          onValueChange={(isActive) => void changeActive(isActive)}
          trueLabel="Active"
          falseLabel="Inactive"
        />
        <div className="flex items-center gap-1">{moveButtons}</div>
        <SaveStateIndicator state={autosave.state} onRetry={autosave.retry} />
      </div>
      {message ? (
        <FieldError id={messageId} className="lg:basis-full">{message}</FieldError>
      ) : null}
    </div>
  );
}
