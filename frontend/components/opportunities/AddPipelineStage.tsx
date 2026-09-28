"use client";

import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";

import { STAGE_OUTCOMES } from "@/components/opportunities/PipelineStageRow";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PipelineSettingsError } from "@/hooks/sales/useOpportunityPipeline";

type Props = {
  onAdd: (stage: { label: string; semantic_type: string }) => Promise<unknown>;
};

/**
 * Adds a stage to the pipeline. A create, so it commits on an explicit button rather than
 * autosaving like the rows above it (R1): a half-typed name is not a stage.
 *
 * The key is derived from the name on the server and is permanent; a step of the sale lands
 * before the won/lost stages, an outcome after them, and either can be moved.
 */
export function AddPipelineStage({ onAdd }: Props) {
  const [label, setLabel] = useState("");
  const [semanticType, setSemanticType] = useState("ongoing");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const name = label.trim();
    if (!name) {
      setError("A stage needs a name.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onAdd({ label: name, semantic_type: semanticType });
      setLabel("");
      setSemanticType("ongoing");
    } catch (caught) {
      setError(caught instanceof PipelineSettingsError ? caught.message : "The stage could not be added. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end" aria-label="Add a stage">
      <Field className="sm:w-64">
        <FieldLabel htmlFor="pipeline-new-stage-name">New stage</FieldLabel>
        <Input
          id="pipeline-new-stage-name"
          value={label}
          maxLength={80}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "pipeline-new-stage-error" : "pipeline-new-stage-help"}
          onChange={(event) => setLabel(event.target.value)}
        />
      </Field>
      <Field className="sm:w-40">
        <FieldLabel htmlFor="pipeline-new-stage-outcome">Outcome</FieldLabel>
        <Select value={semanticType} onValueChange={setSemanticType}>
          <SelectTrigger id="pipeline-new-stage-outcome">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STAGE_OUTCOMES.map((outcome) => (
              <SelectItem key={outcome.value} value={outcome.value}>{outcome.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Button type="submit" variant="outline" disabled={submitting}>
        <Plus />
        {submitting ? "Adding…" : "Add stage"}
      </Button>
      <div className="sm:basis-full">
        {error ? (
          <FieldError id="pipeline-new-stage-error">{error}</FieldError>
        ) : (
          <FieldDescription id="pipeline-new-stage-help">
            A new step goes before the won and lost stages; an outcome goes after them.
          </FieldDescription>
        )}
      </div>
    </form>
  );
}
