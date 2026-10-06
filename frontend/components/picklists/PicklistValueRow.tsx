"use client";

import { useCallback, useState, type ReactNode } from "react";
import { GitMerge } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SaveStateIndicator } from "@/components/ui/SaveStateIndicator";
import { SegmentedBoolean } from "@/components/ui/SegmentedControl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAutosave } from "@/hooks/useAutosave";
import { picklistErrorMessage, type AdminPicklist, type PicklistValueChange } from "@/hooks/usePicklistAdmin";
import type { PicklistValue } from "@/hooks/usePicklists";

/** What a lead status value means to conversion, scoring, automations and reports. */
export const MEANING_LABELS: Record<string, string> = {
  open: "Open",
  working: "Working",
  qualified: "Qualified",
  unqualified: "Unqualified",
  converted: "Converted",
};

/**
 * The tone a status takes where colour is allowed (a record header). Lists stay plain ink
 * whatever the tone, except for attention and critical (rebuild R5).
 */
const TONES = [
  { value: "none", label: "Plain" },
  { value: "success", label: "Success" },
  { value: "attention", label: "Attention" },
  { value: "critical", label: "Critical" },
];

type Props = {
  picklist: AdminPicklist;
  value: PicklistValue;
  recordCount: number;
  handle: ReactNode;
  moveButtons: ReactNode;
  onSave: (valueKey: string, change: PicklistValueChange) => Promise<unknown>;
  onMerge: (value: PicklistValue) => void;
};

/**
 * One value of a picklist, as a settings row (design.md §4.7 archetype 4). Each control is one
 * reversible field and autosaves (R1). The key is shown and never editable: records, saved
 * views and automations store it.
 */
export function PicklistValueRow({ picklist, value, recordCount, handle, moveButtons, onSave, onMerge }: Props) {
  const [label, setLabel] = useState(value.label);
  const [message, setMessage] = useState<string | null>(null);
  const hasMeanings = picklist.meanings.length > 0;

  const commit = useCallback(
    async (change: PicklistValueChange) => {
      setMessage(null);
      try {
        await onSave(value.key, change);
      } catch (error) {
        setMessage(picklistErrorMessage(error));
        throw error;
      }
    },
    [onSave, value.key],
  );
  const autosave = useAutosave(commit);

  function commitLabel() {
    const next = label.trim();
    if (next === value.label) return;
    if (!next) {
      setLabel(value.label);
      return;
    }
    void autosave.save({ label: next });
  }

  const nameId = `picklist-value-${value.key}-name`;
  const messageId = `picklist-value-${value.key}-message`;

  return (
    <div data-testid={`picklist-value-${value.key}`} className="flex flex-col gap-3 px-3 py-3 lg:flex-row lg:flex-wrap lg:items-center">
      <div className="flex min-w-0 items-center gap-2 lg:w-64">
        {handle}
        <div className="min-w-0 flex-1">
          {picklist.is_locked ? (
            <p id={nameId} className="truncate text-sm text-copy-primary">{value.label}</p>
          ) : (
            <Input
              id={nameId}
              aria-label={`${value.label} label`}
              aria-describedby={message ? messageId : undefined}
              aria-invalid={Boolean(message)}
              value={label}
              maxLength={150}
              onChange={(event) => setLabel(event.target.value)}
              onBlur={commitLabel}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          )}
          <p className="mt-1 truncate text-p-xs text-copy-muted">
            Key {value.key} · {recordCount} {recordCount === 1 ? "record" : "records"}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {hasMeanings ? (
          <Select value={value.meaning ?? ""} onValueChange={(meaning) => void autosave.save({ meaning })}>
            <SelectTrigger className="w-36" aria-label={`${value.label} meaning`}>
              <SelectValue placeholder="Meaning" />
            </SelectTrigger>
            <SelectContent>
              {picklist.meanings.map((meaning) => (
                <SelectItem key={meaning} value={meaning}>{MEANING_LABELS[meaning] ?? meaning}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {hasMeanings ? (
          <Select value={value.tone ?? "none"} onValueChange={(tone) => void autosave.save({ tone: tone === "none" ? null : (tone as PicklistValue["tone"]) })}>
            <SelectTrigger className="w-32" aria-label={`${value.label} tone`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TONES.map((tone) => <SelectItem key={tone.value} value={tone.value}>{tone.label}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : null}
        <SegmentedBoolean
          aria-label={`${value.label} default`}
          value={value.is_default}
          onValueChange={(isDefault) => void autosave.save({ is_default: isDefault })}
          trueLabel="Default"
          falseLabel="Not default"
        />
        <SegmentedBoolean
          aria-label={`${value.label} availability`}
          value={value.is_active}
          onValueChange={(isActive) => void autosave.save({ is_active: isActive })}
          trueLabel="Active"
          falseLabel="Inactive"
        />
        <div className="flex items-center gap-1">{moveButtons}</div>
        {!picklist.is_locked ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onMerge(value)}>
            <GitMerge />
            Merge into…
          </Button>
        ) : null}
        <SaveStateIndicator state={autosave.state} onRetry={autosave.retry} />
      </div>
      {message ? <FieldError id={messageId} className="lg:basis-full">{message}</FieldError> : null}
    </div>
  );
}
