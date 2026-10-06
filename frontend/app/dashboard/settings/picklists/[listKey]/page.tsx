"use client";

import { useCallback, useMemo, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { Plus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { FormSection } from "@/components/forms/RecordFormLayout";
import { MEANING_LABELS, PicklistValueRow } from "@/components/picklists/PicklistValueRow";
import { PicklistMergeDialog } from "@/components/picklists/PicklistMergeDialog";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { RecordTable } from "@/components/ui/RecordTable";
import { SaveStateIndicator } from "@/components/ui/SaveStateIndicator";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import SearchBar from "@/components/ui/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SortableList } from "@/components/ui/SortableList";
import { useAutosave } from "@/hooks/useAutosave";
import {
  ADMIN_PICKLISTS_QUERY_KEY,
  addPicklistValue,
  adminPicklistQueryKey,
  mergePicklistValues,
  picklistErrorMessage,
  reorderPicklistValues,
  renamePicklist,
  resolveUnmatchedValue,
  unmatchedQueryKey,
  updatePicklistValue,
  useAdminPicklist,
  useUnmatchedValues,
  type AdminPicklist,
  type PicklistValueChange,
} from "@/hooks/usePicklistAdmin";
import { useInvalidatePicklists, type PicklistValue } from "@/hooks/usePicklists";
import { isForbiddenError } from "@/lib/api";
import { SETTINGS_ROUTES } from "@/lib/routes";

/** Lists longer than this get a search box; reordering pauses while it filters. */
const SEARCH_THRESHOLD = 20;

/**
 * One picklist (13b §3.1): its values in order, each autosaving (R1); a value is added with
 * an explicit button, never deleted (only switched off, so old records still read); *Merge
 * into…* moves records onto another value. *Values not in the list* shows what records hold
 * that the list does not, from before picklists or from an import.
 */
export default function PicklistEditorPage() {
  const params = useParams<{ listKey?: string }>();
  const listKey = decodeURIComponent(params.listKey ?? "");
  const queryClient = useQueryClient();
  const invalidatePicklists = useInvalidatePicklists();
  const listQuery = useAdminPicklist(listKey);
  const unmatched = useUnmatchedValues(listKey);
  const picklist = listQuery.data;
  const [search, setSearch] = useState("");
  const [merging, setMerging] = useState<PicklistValue | null>(null);

  const counts = useMemo(() => {
    const totals = new Map<string, number>();
    for (const field of picklist?.usage ?? []) {
      for (const [key, count] of Object.entries(field.counts)) totals.set(key, (totals.get(key) ?? 0) + count);
    }
    return totals;
  }, [picklist?.usage]);

  const applySaved = useCallback(
    async (next?: AdminPicklist) => {
      if (next) queryClient.setQueryData<AdminPicklist>(adminPicklistQueryKey(listKey), (current) => ({ ...next, usage: current?.usage }));
      // Forms, filters and list cells everywhere read the lists through `usePicklists`.
      await Promise.all([
        invalidatePicklists(),
        queryClient.invalidateQueries({ queryKey: ADMIN_PICKLISTS_QUERY_KEY, exact: true }),
      ]);
    },
    [invalidatePicklists, listKey, queryClient],
  );
  const refreshUsage = useCallback(
    () => Promise.all([
      queryClient.invalidateQueries({ queryKey: adminPicklistQueryKey(listKey), exact: true }),
      queryClient.invalidateQueries({ queryKey: unmatchedQueryKey(listKey) }),
    ]),
    [listKey, queryClient],
  );

  const saveValue = useCallback(
    async (valueKey: string, change: PicklistValueChange) => applySaved(await updatePicklistValue(listKey, valueKey, change)),
    [applySaved, listKey],
  );

  const commitOrder = useCallback(
    async (keys: string[]) => applySaved(await reorderPicklistValues(listKey, keys)),
    [applySaved, listKey],
  );
  const order = useAutosave(commitOrder);

  const renameList = useCallback(
    async (label: string) => applySaved(await renamePicklist(listKey, label)),
    [applySaved, listKey],
  );
  const rename = useAutosave(renameList);
  const [listLabel, setListLabel] = useState<string | null>(null);

  const values = useMemo(() => [...(picklist?.values ?? [])].sort((a, b) => a.position - b.position), [picklist?.values]);
  const filtering = Boolean(search.trim());
  const visible = filtering
    ? values.filter((value) => value.label.toLowerCase().includes(search.trim().toLowerCase()) || value.key.toLowerCase().includes(search.trim().toLowerCase()))
    : values;

  const isForbidden = isForbiddenError(listQuery.error);
  const title = picklist?.label ?? "Picklist";

  return (
    <PageShell
      variant="settings"
      title={title}
      description={
        picklist?.is_locked
          ? "The platform defines these values. Switch off the ones your workspace never uses so pickers stay short."
          : "Records keep each value's key, so renaming a value never changes them. Values are switched off, never deleted."
      }
      isPermissionDenied={isForbidden}
      isLoading={listQuery.isPending}
      hasError={!isForbidden && Boolean(listQuery.error)}
      errorDescription="Nothing has been changed. Try the request again."
      onRetry={() => void listQuery.refetch()}
      backHref={SETTINGS_ROUTES.picklists}
      backLabel="Back to picklists"
    >
      {picklist ? (
        <>
          {!picklist.is_system ? (
            <FormSection title="List" description="The name shown in field settings." action={<SaveStateIndicator state={rename.state} onRetry={rename.retry} />}>
              <Field className="sm:w-72">
                <FieldLabel htmlFor="picklist-name">Name</FieldLabel>
                <Input
                  id="picklist-name"
                  value={listLabel ?? picklist.label}
                  maxLength={150}
                  onChange={(event) => setListLabel(event.target.value)}
                  onBlur={() => {
                    const next = (listLabel ?? "").trim();
                    if (next && next !== picklist.label) void rename.save(next);
                    else setListLabel(null);
                  }}
                />
              </Field>
            </FormSection>
          ) : null}

          <FormSection
            title="Values"
            description={
              picklist.meanings.length
                ? "Each value means one of a fixed set of things; conversion, scoring, automations and reports read the meaning, never the name. The default is what a new record starts as."
                : picklist.used_by.length
                  ? `Used by ${picklist.used_by.map((field) => field.label).join(", ")}. The order here is the order pickers show.`
                  : "The order here is the order pickers show."
            }
            action={<SaveStateIndicator state={order.state} onRetry={order.retry} />}
          >
            {values.length > SEARCH_THRESHOLD ? (
              <SearchBar value={search} onChange={setSearch} placeholder="Search values" className="mb-3 sm:max-w-sm" />
            ) : null}
            {visible.length ? (
              <SortableList
                label={`${picklist.label} values`}
                className="divide-y divide-line-subtle rounded-[var(--radius-control)] border border-line-default"
                items={visible}
                getKey={(value) => value.key}
                getItemLabel={(value) => value.label}
                disabled={filtering}
                onMove={(from, to) => {
                  if (order.isSaving || filtering) return;
                  const keys = values.map((value) => value.key);
                  const [moved] = keys.splice(from, 1);
                  keys.splice(to, 0, moved);
                  void order.save(keys);
                }}
                renderItem={(value, { handle, moveButtons }) => (
                  <PicklistValueRow
                    picklist={picklist}
                    value={value}
                    recordCount={counts.get(value.key) ?? 0}
                    handle={handle}
                    moveButtons={moveButtons}
                    onSave={saveValue}
                    onMerge={setMerging}
                  />
                )}
              />
            ) : (
              <p className="text-p-sm text-copy-muted">{filtering ? "No value matches the search." : "No values yet. Add the first one below."}</p>
            )}
            {!picklist.is_locked ? (
              <AddPicklistValue
                picklist={picklist}
                onAdd={async (body) => {
                  await applySaved(await addPicklistValue(listKey, body));
                }}
              />
            ) : null}
          </FormSection>

          {picklist.used_by.length ? (
            <UnmatchedValues
              picklist={picklist}
              rows={unmatched.data ?? []}
              isLoading={unmatched.isLoading}
              hasError={Boolean(unmatched.error)}
              onRetry={() => void unmatched.refetch()}
              onResolve={async (value, intoKey) => {
                const result = await resolveUnmatchedValue(listKey, value, intoKey);
                await applySaved(result.picklist);
                await refreshUsage();
              }}
            />
          ) : null}

          <PicklistMergeDialog
            picklist={picklist}
            value={merging}
            recordCount={merging ? counts.get(merging.key) ?? 0 : 0}
            onClose={() => setMerging(null)}
            onMerge={async (fromKey, intoKey) => {
              const result = await mergePicklistValues(listKey, fromKey, intoKey);
              await applySaved(result.picklist);
              await refreshUsage();
              return result.moved;
            }}
          />
        </>
      ) : null}
    </PageShell>
  );
}

function AddPicklistValue({ picklist, onAdd }: { picklist: AdminPicklist; onAdd: (body: { label: string; meaning?: string | null }) => Promise<void> }) {
  const [label, setLabel] = useState("");
  const [meaning, setMeaning] = useState(picklist.meanings[0] ?? "");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const name = label.trim();
    if (!name) {
      setError("A value needs a label.");
      return;
    }
    setAdding(true);
    setError(null);
    try {
      await onAdd({ label: name, meaning: picklist.meanings.length ? meaning : null });
      setLabel("");
    } catch (caught) {
      setError(picklistErrorMessage(caught, "The value could not be added. Try again."));
    } finally {
      setAdding(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end" aria-label="Add a value">
      <Field className="sm:w-64">
        <FieldLabel htmlFor="picklist-new-value">New value</FieldLabel>
        <Input
          id="picklist-new-value"
          value={label}
          maxLength={150}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "picklist-new-value-error" : "picklist-new-value-help"}
          onChange={(event) => setLabel(event.target.value)}
        />
      </Field>
      {picklist.meanings.length ? (
        <Field className="sm:w-40">
          <FieldLabel htmlFor="picklist-new-value-meaning">Meaning</FieldLabel>
          <Select value={meaning} onValueChange={setMeaning}>
            <SelectTrigger id="picklist-new-value-meaning"><SelectValue /></SelectTrigger>
            <SelectContent>
              {picklist.meanings.map((item) => <SelectItem key={item} value={item}>{MEANING_LABELS[item] ?? item}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      ) : null}
      <Button type="submit" variant="outline" disabled={adding}>
        <Plus />
        {adding ? "Adding…" : "Add value"}
      </Button>
      <div className="sm:basis-full">
        {error ? <FieldError id="picklist-new-value-error">{error}</FieldError> : (
          <FieldDescription id="picklist-new-value-help">The key is made from the label and never changes.</FieldDescription>
        )}
      </div>
    </form>
  );
}

function UnmatchedValues({
  picklist,
  rows,
  isLoading,
  hasError,
  onRetry,
  onResolve,
}: {
  picklist: AdminPicklist;
  rows: { value: string; count: number; fields: string[] }[];
  isLoading: boolean;
  hasError: boolean;
  onRetry: () => void;
  onResolve: (value: string, intoKey: string | null) => Promise<void>;
}) {
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const options = picklist.values.filter((value) => value.is_active).map((value) => ({ value: value.key, label: value.label }));
  const canAdd = !picklist.is_locked && !picklist.meanings.length;

  async function resolve(raw: string, intoKey: string | null) {
    setBusy(raw);
    setErrors((current) => ({ ...current, [raw]: "" }));
    try {
      await onResolve(raw, intoKey);
    } catch (caught) {
      setErrors((current) => ({ ...current, [raw]: picklistErrorMessage(caught, "The records could not be moved. Try again.") }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <FormSection
      title="Values not in the list"
      description={
        canAdd
          ? "Records hold these, but the list does not: free text from before picklists, or an import. Add one to the list, or move its records onto a value."
          : "Records hold these, but the list does not. Move each one's records onto a value."
      }
    >
      <RecordTable
        label="Values not in the list"
        shellVariant="nested"
        columns={[
          { key: "value", label: "Stored value", size: "lg", render: (row) => <span className="text-copy-primary">{row.value}</span> },
          { key: "count", label: "Records", size: "sm", align: "right", render: (row) => <span className="tabular-nums">{row.count}</span> },
          { key: "fields", label: "Fields", render: (row) => <span className="text-sm text-copy-secondary">{row.fields.join(", ")}</span> },
          {
            key: "move",
            label: "Move records to",
            interactive: true,
            render: (row) => (
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="w-56">
                    <SearchableSelect
                      label={`Move records holding ${row.value} to`}
                      value={targets[row.value] ?? ""}
                      options={options}
                      size="sm"
                      placeholder="Choose a value"
                      onValueChange={(key) => setTargets((current) => ({ ...current, [row.value]: key }))}
                    />
                  </div>
                  <Button type="button" size="sm" variant="outline" disabled={!targets[row.value] || busy === row.value} onClick={() => void resolve(row.value, targets[row.value])}>
                    Move
                  </Button>
                  {canAdd ? (
                    <Button type="button" size="sm" variant="ghost" disabled={busy === row.value} onClick={() => void resolve(row.value, null)}>
                      Add to list
                    </Button>
                  ) : null}
                </div>
                {errors[row.value] ? <FieldError>{errors[row.value]}</FieldError> : null}
              </div>
            ),
          },
        ]}
        rows={rows}
        rowKey={(row) => row.value}
        isLoading={isLoading}
        hasError={hasError}
        onRetry={onRetry}
        errorState={{ title: "Stray values could not be loaded" }}
        emptyState={{ title: "Every stored value is in the list", description: "Nothing to tidy up." }}
      />
    </FormSection>
  );
}
