"use client";

import { useMemo, useState } from "react";
import { Percent, Plus, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EditorPanel } from "@/components/ui/EditorPanel";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { RecordTable } from "@/components/ui/RecordTable";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { SegmentedBoolean, SegmentedControl, SegmentedItem } from "@/components/ui/SegmentedControl";
import type { SaveState } from "@/components/ui/SaveStateIndicator";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { StatusValue } from "@/components/ui/StatusValue";
import { useDefaultTaxMode, useTaxRateActions, useTaxRates, type TaxMode, type TaxRate, type TaxRatePayload } from "@/hooks/finance/useTaxRates";
import { useConfirm } from "@/hooks/useConfirm";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { apiFetch, isForbiddenError } from "@/lib/api";
import { SETTINGS_ROUTES } from "@/lib/routes";
import { getCatalogActiveState } from "@/lib/statusStyles";

type Draft = {
  name: string;
  kind: "rate" | "group";
  rate: string;
  member_ids: number[];
  is_active: boolean;
  is_default_sales: boolean;
  is_default_purchases: boolean;
};
const EMPTY_DRAFT: Draft = { name: "", kind: "rate", rate: "", member_ids: [], is_active: true, is_default_sales: false, is_default_purchases: false };

function draftFrom(rate: TaxRate): Draft {
  return {
    name: rate.name,
    kind: rate.kind,
    rate: String(Number(rate.rate)),
    member_ids: rate.members.map((member) => member.id),
    is_active: rate.is_active,
    is_default_sales: rate.is_default_sales,
    is_default_purchases: rate.is_default_purchases,
  };
}

function percent(value: string | number) {
  return `${Number(value)}%`;
}

function defaultsLabel(rate: TaxRate) {
  const sides = [rate.is_default_sales ? "Sales" : null, rate.is_default_purchases ? "Purchases" : null].filter(Boolean);
  return sides.length ? sides.join(", ") : "—";
}

/**
 * Settings → Taxes (13d §3.1): rates and groups, which rate sales and purchase lines start
 * with, and whether new documents' prices include tax. The catalog-categories pattern: a
 * `RecordTable` plus an `EditorPanel`.
 */
export default function TaxSettingsPage() {
  const { confirm } = useConfirm();
  const queryClient = useQueryClient();
  const rates = useTaxRates();
  const defaultMode = useDefaultTaxMode();
  const { create, update, remove } = useTaxRateActions();
  const [editing, setEditing] = useState<TaxRate | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({ ...EMPTY_DRAFT });
  const [errors, setErrors] = useState<{ name?: string; rate?: string; members?: string }>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [modeState, setModeState] = useState<SaveState>("idle");
  const savingMode = modeState === "saving";
  const isSaving = create.isPending || update.isPending;

  const initial = editing ? draftFrom(editing) : EMPTY_DRAFT;
  const isDirty = JSON.stringify(draft) !== JSON.stringify(initial);
  useUnsavedChangesGuard(isDirty, isSaving);

  // A group combines rates, never other groups; its own rate is their sum.
  const memberOptions = useMemo(
    () => (rates.data ?? []).filter((rate) => rate.kind === "rate" && (rate.is_active || draft.member_ids.includes(rate.id))),
    [rates.data, draft.member_ids],
  );
  const groupRate = memberOptions.filter((rate) => draft.member_ids.includes(rate.id)).reduce((sum, rate) => sum + Number(rate.rate), 0);

  async function confirmDiscard() {
    if (!isDirty) return true;
    return confirm({ title: "Discard tax rate changes?", description: "The current draft will be lost.", confirmLabel: "Discard changes", variant: "destructive" });
  }

  async function openEditor(rate: TaxRate | null) {
    if (!(await confirmDiscard())) return;
    setEditing(rate);
    setDraft(rate ? draftFrom(rate) : { ...EMPTY_DRAFT });
    setErrors({});
    setSaveError(null);
    setEditorOpen(true);
  }

  async function closeEditor() {
    if (!(await confirmDiscard())) return;
    setEditing(null);
    setDraft({ ...EMPTY_DRAFT });
    setEditorOpen(false);
  }

  async function save() {
    const next: typeof errors = {};
    if (!draft.name.trim()) next.name = "Enter a name, like VAT 20%.";
    const value = Number(draft.rate);
    if (draft.kind === "rate" && (draft.rate.trim() === "" || !Number.isFinite(value) || value < 0 || value > 100)) next.rate = "Enter a rate between 0 and 100.";
    if (draft.kind === "group" && draft.member_ids.length < 2) next.members = "Choose at least two rates.";
    setErrors(next);
    if (Object.keys(next).length) return;
    const payload: TaxRatePayload = {
      name: draft.name.trim(),
      is_default_sales: draft.is_default_sales,
      is_default_purchases: draft.is_default_purchases,
    };
    const changesFigure = !editing || (draft.kind === "rate" ? Number(editing.rate) !== value : JSON.stringify(initial.member_ids) !== JSON.stringify(draft.member_ids));
    if (changesFigure) {
      if (draft.kind === "rate") payload.rate = draft.rate.trim();
      else payload.member_ids = draft.member_ids;
    }
    try {
      setSaveError(null);
      if (editing) {
        await update.mutateAsync({ id: editing.id, payload: { ...payload, is_active: draft.is_active } });
        toast.success("Tax rate saved.");
      } else {
        await create.mutateAsync({ ...payload, kind: draft.kind });
        toast.success(draft.kind === "group" ? "Tax group added." : "Tax rate added.");
      }
      setEditing(null);
      setDraft({ ...EMPTY_DRAFT });
      setEditorOpen(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "The tax rate could not be saved.");
    }
  }

  async function deleteRate(rate: TaxRate) {
    const confirmed = await confirm({
      title: `Delete ${rate.name}?`,
      description: "A rate that documents, items or groups use cannot be deleted; deactivate it instead.",
      confirmLabel: "Delete rate",
      variant: "destructive",
    });
    if (!confirmed) return;
    try {
      await remove.mutateAsync(rate.id);
      toast.success("Tax rate deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The tax rate could not be deleted.");
    }
  }

  async function saveDefaultMode(mode: TaxMode) {
    try {
      setModeState("saving");
      const res = await apiFetch("/users/company", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ default_tax_mode: mode }),
      });
      if (!res.ok) throw new Error("The default could not be saved.");
      await queryClient.invalidateQueries({ queryKey: ["company-default-tax-mode"] });
      setModeState("saved");
    } catch {
      setModeState("error");
    }
  }

  return (
    <PageShell
      variant="settings"
      title="Taxes"
      description="The rates document lines use, the rates sales and purchases start with, and whether prices include tax."
      actions={<Button type="button" onClick={() => void openEditor(null)}><Plus />Add tax rate</Button>}
      isPermissionDenied={isForbiddenError(rates.error)}
      backHref={SETTINGS_ROUTES.root}
      backLabel="Back to settings"
    >
      <SettingsRow
        label="Prices on new documents"
        saveState={modeState}
        description="Each quote, order and invoice can change it. Purchase prices are always before tax."
      >
        <SegmentedControl
          value={defaultMode.data ?? "exclusive"}
          onValueChange={(mode) => void saveDefaultMode(mode as TaxMode)}
          aria-label="Prices on new documents"
        >
          <SegmentedItem value="exclusive" disabled={savingMode}>Tax exclusive</SegmentedItem>
          <SegmentedItem value="inclusive" disabled={savingMode}>Tax inclusive</SegmentedItem>
        </SegmentedControl>
      </SettingsRow>

      <EditorPanel
        open={editorOpen}
        onOpenChange={(open) => (open ? setEditorOpen(true) : void closeEditor())}
        title={editing ? `Edit ${editing.kind === "group" ? "tax group" : "tax rate"}` : "Add tax rate"}
        description="A rate already on documents keeps its figure; to change it, add a new rate and deactivate this one."
        closeLabel="Close tax rate editor"
        onSubmit={() => void save()}
        status={saveError ? <span role="alert" className="text-state-danger">{saveError}</span> : isDirty ? "Unsaved changes" : null}
        footer={(
          <>
            <Button type="button" variant="outline" onClick={() => void closeEditor()} disabled={isSaving}>Cancel</Button>
            <Button type="submit" disabled={isSaving || (Boolean(editing) && !isDirty)}>
              {isSaving ? "Saving…" : editing ? "Save" : "Add"}
            </Button>
          </>
        )}
      >
        <FieldGroup>
          {!editing ? (
            <Field>
              <FieldLabel id="tax-rate-kind-label">Kind</FieldLabel>
              <SegmentedControl value={draft.kind} onValueChange={(kind) => setDraft((current) => ({ ...current, kind: kind as Draft["kind"] }))} aria-label="Kind">
                <SegmentedItem value="rate">Rate</SegmentedItem>
                <SegmentedItem value="group">Group</SegmentedItem>
              </SegmentedControl>
              <FieldDescription>A group combines several rates on one line, like state and city tax.</FieldDescription>
            </Field>
          ) : null}
          <Field data-invalid={Boolean(errors.name)}>
            <FieldLabel htmlFor="tax-rate-name">Name <RequiredMark /></FieldLabel>
            <Input
              id="tax-rate-name"
              value={draft.name}
              maxLength={120}
              onChange={(event) => { setDraft((current) => ({ ...current, name: event.target.value })); setErrors((current) => ({ ...current, name: undefined })); }}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? "tax-rate-name-error" : undefined}
            />
            {errors.name ? <FieldError id="tax-rate-name-error">{errors.name}</FieldError> : null}
          </Field>
          {draft.kind === "rate" ? (
            <Field data-invalid={Boolean(errors.rate)}>
              <FieldLabel htmlFor="tax-rate-rate">Rate (%) <RequiredMark /></FieldLabel>
              <Input
                id="tax-rate-rate"
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                step="0.0001"
                value={draft.rate}
                onChange={(event) => { setDraft((current) => ({ ...current, rate: event.target.value })); setErrors((current) => ({ ...current, rate: undefined })); }}
                aria-invalid={Boolean(errors.rate)}
                aria-describedby={errors.rate ? "tax-rate-rate-error" : undefined}
              />
              {errors.rate ? <FieldError id="tax-rate-rate-error">{errors.rate}</FieldError> : null}
            </Field>
          ) : (
            <FieldSet data-invalid={Boolean(errors.members)}>
              <FieldLegend>Rates in this group <RequiredMark /></FieldLegend>
              <FieldDescription>Together {percent(groupRate)}.</FieldDescription>
              <div className="flex flex-col gap-2">
                {memberOptions.length ? memberOptions.map((rate) => (
                  <label key={rate.id} className="flex items-center gap-2 text-sm text-copy-primary">
                    <Checkbox
                      className="shrink-0"
                      checked={draft.member_ids.includes(rate.id)}
                      onCheckedChange={(checked) => {
                        setErrors((current) => ({ ...current, members: undefined }));
                        setDraft((current) => ({
                          ...current,
                          member_ids: checked === true ? [...current.member_ids, rate.id] : current.member_ids.filter((id) => id !== rate.id),
                        }));
                      }}
                    />
                    {rate.name} <span className="text-copy-muted">{percent(rate.rate)}</span>
                  </label>
                )) : <p className="text-sm text-copy-muted">Add the rates first, then combine them here.</p>}
              </div>
              {errors.members ? <FieldError>{errors.members}</FieldError> : null}
            </FieldSet>
          )}
          <Field>
            <FieldLabel id="tax-rate-default-sales">Default for sales</FieldLabel>
            <SegmentedBoolean
              aria-label="Default for sales"
              value={draft.is_default_sales}
              onValueChange={(value) => setDraft((current) => ({ ...current, is_default_sales: value }))}
              trueLabel="Default"
              falseLabel="Not default"
              disabled={!draft.is_active}
            />
            <FieldDescription>Sales lines whose item names no rate start with this one.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel id="tax-rate-default-purchases">Default for purchases</FieldLabel>
            <SegmentedBoolean
              aria-label="Default for purchases"
              value={draft.is_default_purchases}
              onValueChange={(value) => setDraft((current) => ({ ...current, is_default_purchases: value }))}
              trueLabel="Default"
              falseLabel="Not default"
              disabled={!draft.is_active}
            />
          </Field>
          {editing ? (
            <Field>
              <FieldLabel id="tax-rate-active">Status</FieldLabel>
              <SegmentedBoolean
                aria-label="Status"
                value={draft.is_active}
                onValueChange={(value) => setDraft((current) => ({
                  ...current,
                  is_active: value,
                  ...(value ? {} : { is_default_sales: false, is_default_purchases: false }),
                }))}
                trueLabel="Active"
                falseLabel="Inactive"
              />
              <FieldDescription>An inactive rate stays on the documents that used it, and is not offered on new lines.</FieldDescription>
            </Field>
          ) : null}
        </FieldGroup>
      </EditorPanel>

      <RecordTable
        label="Tax rates"
        columns={[
          {
            key: "name",
            label: "Name",
            size: "lg",
            render: (rate) => (
              <>
                <div className="font-medium text-copy-primary">{rate.name}</div>
                {rate.kind === "group" ? <div className="mt-1 text-xs text-copy-muted">{rate.members.map((member) => member.name).join(" + ")}</div> : null}
              </>
            ),
          },
          { key: "rate", label: "Rate", size: "sm", align: "right", render: (rate) => <span className="tabular-nums">{percent(rate.rate)}</span> },
          { key: "defaults", label: "Default for", size: "md", render: (rate) => <span className="text-sm text-copy-secondary">{defaultsLabel(rate)}</span> },
          {
            key: "status",
            label: "Status",
            size: "sm",
            render: (rate) => <StatusValue status={getCatalogActiveState(rate.is_active)} />,
          },
        ]}
        rows={rates.data ?? []}
        rowKey={(rate) => rate.id}
        onOpenRow={(rate) => void openEditor(rate)}
        rowLabel={(rate) => `Edit ${rate.name}`}
        isLoading={rates.isLoading}
        isRefreshing={rates.isFetching && !rates.isLoading}
        isPermissionDenied={isForbiddenError(rates.error)}
        hasError={Boolean(rates.error) && !isForbiddenError(rates.error)}
        onRetry={() => void rates.refetch()}
        errorState={{ title: "Tax rates could not be loaded" }}
        emptyState={{
          icon: Percent,
          title: "No tax rates yet",
          description: "Add the rates your business charges, then mark one as the default for sales.",
          action: <Button type="button" onClick={() => void openEditor(null)}><Plus />Add tax rate</Button>,
        }}
        rowActions={(rate) => (
          <Button type="button" size="icon" variant="ghost" aria-label={`Delete ${rate.name}`} onClick={() => void deleteRate(rate)}>
            <Trash2 />
          </Button>
        )}
      />
    </PageShell>
  );
}
