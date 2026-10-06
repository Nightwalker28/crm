"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBackdrop, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogTitle } from "@/components/ui/dialog";
import { DialogIconClose } from "@/components/ui/DialogIconClose";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { picklistErrorMessage, type AdminPicklist } from "@/hooks/usePicklistAdmin";
import type { PicklistValue } from "@/hooks/usePicklists";

type Props = {
  picklist: AdminPicklist;
  value: PicklistValue | null;
  recordCount: number;
  onClose: () => void;
  onMerge: (fromKey: string, intoKey: string) => Promise<{ records: number; views: number; rules: number }>;
};

/**
 * *Merge into…* (13b §3.1, Zoho's *Replace*): every record, saved view filter and automation
 * condition holding this value moves to the one chosen, and this value is switched off. It
 * cannot be undone by a click, so it asks first and says what it will touch.
 */
export function PicklistMergeDialog({ picklist, value, recordCount, onClose, onMerge }: Props) {
  const [intoKey, setIntoKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const options = picklist.values
    .filter((item) => value && item.key !== value.key && item.is_active && (!picklist.meanings.length || item.meaning === value.meaning))
    .map((item) => ({ value: item.key, label: item.label }));

  async function merge() {
    if (!value || !intoKey) return;
    setMerging(true);
    setError(null);
    try {
      await onMerge(value.key, intoKey);
      setIntoKey("");
      onClose();
    } catch (caught) {
      setError(picklistErrorMessage(caught, "The values could not be merged. Try again."));
    } finally {
      setMerging(false);
    }
  }

  return (
    <Dialog open={Boolean(value)} onClose={onClose}>
      <DialogBackdrop />
      <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
        <DialogPanel size="md" className="rounded-[var(--radius-dialog)] border-line-default bg-surface-raised">
          <DialogHeader>
            <DialogTitle>Merge “{value?.label}”</DialogTitle>
            <DialogIconClose />
          </DialogHeader>
          <DialogDescription className="mt-2">
            {recordCount} {recordCount === 1 ? "record moves" : "records move"} to the value you choose, with any saved view or
            automation condition that names it. “{value?.label}” is then switched off.
          </DialogDescription>
          <Field className="mt-4" data-invalid={Boolean(error)}>
            <FieldLabel htmlFor="picklist-merge-into">Merge into</FieldLabel>
            <SearchableSelect
              id="picklist-merge-into"
              label="Merge into"
              value={intoKey}
              options={options}
              onValueChange={setIntoKey}
              placeholder="Choose a value"
              ariaInvalid={Boolean(error)}
            />
            {error ? <FieldError>{error}</FieldError> : (
              picklist.meanings.length ? <FieldDescription>Only values with the same meaning are offered, so no record changes what it means.</FieldDescription> : null
            )}
          </Field>
          <DialogFooter className="mt-6">
            <Button type="button" variant="ghost" onClick={onClose} disabled={merging}>Cancel</Button>
            <Button type="button" onClick={() => void merge()} disabled={!intoKey || merging}>{merging ? "Merging…" : "Merge values"}</Button>
          </DialogFooter>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
