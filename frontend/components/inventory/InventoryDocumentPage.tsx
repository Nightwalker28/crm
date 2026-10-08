"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import { LayoutRecordFormBody } from "@/components/forms/LayoutRecordFormBody";
import type { RecordFormFieldContext, RecordFormValue } from "@/components/forms/RecordForm";
import { QuickCreateField, validateLayoutDrivenQuickCreate } from "@/components/forms/quickCreateLayout";
import { DocumentDetailHeader } from "@/components/transactions/DocumentLayoutHeader";
import { LineItemsEditor, LineNumberInput, type LineCellContext } from "@/components/transactions/LineItemsEditor";
import { FormFooter } from "@/components/ui/ActionBar";
import { Button } from "@/components/ui/button";
import { EditorPanel } from "@/components/ui/EditorPanel";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { RecordTable } from "@/components/ui/RecordTable";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useConfirm } from "@/hooks/useConfirm";
import { useInventoryDocument, useInventoryDocumentActions, useProductStock, useWarehouses, type InventoryDocument, type InventoryKind } from "@/hooks/inventory/useInventory";
import { isForbiddenError } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { useResolvedRecordLayout, type ResolvedRecordLayoutField } from "@/hooks/useResolvedRecordLayout";
import { DocumentHistory } from "@/components/recordActivity/DocumentHistory";

/** The header the `full_form` layout draws (13b Phase 4e), keyed by field key: both kinds' keys. */
type InventoryHeader = RecordFormValue & {
  warehouse_id: number | null;
  warehouse_name: string;
  from_warehouse_id: number | null;
  from_warehouse_name: string;
  to_warehouse_id: number | null;
  to_warehouse_name: string;
  mode: "quantity" | "count";
  reason: string;
  notes: string;
};

const MODES = [
  { value: "quantity", label: "Quantity change" },
  { value: "count", label: "Physical count" },
] as const;

const inventoryInputId = (fieldKey: string) => `inventory-${fieldKey.replace(/_/g, "-")}`;

type DraftLine = { key: number; productId: number | null; name: string; value: string; expected: string | null; unitCost: string };
let nextKey = 1;
const blankLine = (): DraftLine => ({ key: nextKey++, productId: null, name: "", value: "", expected: null, unitCost: "" });

/** What a line's stock says: the quantity expected on a count, and whether added stock needs a cost. */
function useLineStock(line: DraftLine, kind: InventoryKind, mode: "quantity" | "count", warehouseId: number | null) {
  const stock = useProductStock(line.productId);
  const current = stock.data?.warehouses.find((row) => row.id === warehouseId)?.on_hand ?? "0";
  const expected = line.expected ?? current;
  const difference = kind === "adjustments" && mode === "count" && line.value !== "" ? Number(line.value) - Number(expected) : null;
  // Stock added to a product with no cost yet needs a unit cost (12d §3.2).
  const adding = mode === "count" ? (difference ?? 0) > 0 : Number(line.value) > 0;
  return { expected, difference, askCost: kind === "adjustments" && Boolean(stock.data?.needs_cost) && adding };
}

type LineStockProps = { line: DraftLine; kind: InventoryKind; mode: "quantity" | "count"; warehouseId: number | null };

function ExpectedCell(props: LineStockProps) {
  const { expected } = useLineStock(props.line, props.kind, props.mode, props.warehouseId);
  return <span className="tabular-nums text-copy-secondary">{Number(expected).toLocaleString()}</span>;
}

function DifferenceCell(props: LineStockProps) {
  const { difference } = useLineStock(props.line, props.kind, props.mode, props.warehouseId);
  if (difference === null) return <span className="text-copy-muted">—</span>;
  return <span className="tabular-nums text-copy-secondary" aria-label="Difference">{difference > 0 ? "+" : ""}{difference}</span>;
}

function UnitCostCell({ cellProps, onChange, ...props }: LineStockProps & { cellProps: ReturnType<LineCellContext["cellProps"]>; onChange: (value: string) => void }) {
  const { askCost } = useLineStock(props.line, props.kind, props.mode, props.warehouseId);
  if (!askCost) return <span className="text-copy-muted">—</span>;
  const hintId = `inventory-cost-hint-${props.line.key}`;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <LineNumberInput cellProps={cellProps} step="0.0001" ariaLabel={`Unit cost for ${props.line.name || "line"}`} describedBy={hintId} value={props.line.unitCost} onChange={onChange} />
      <span id={hintId} className="text-xs text-copy-muted">{props.line.name || "This product"} has no cost yet. What one unit cost you values the stock added.</span>
    </div>
  );
}

export function InventoryDocumentPage({ kind, documentId = null }: { kind: InventoryKind; documentId?: number | null }) {
  const router = useRouter();
  const { confirm } = useConfirm();
  const { modules, isLoading: modulesLoading } = useAccessibleModules();
  const actions = modules.find((module) => module.name === `inventory_${kind}`)?.actions;
  const warehouses = useWarehouses();
  const query = useInventoryDocument(kind, documentId);
  const mutations = useInventoryDocumentActions(kind);
  const [loadedId, setLoadedId] = useState<number | null>(null);
  const [header, setHeader] = useState<InventoryHeader>({
    warehouse_id: null, warehouse_name: "", from_warehouse_id: null, from_warehouse_name: "",
    to_warehouse_id: null, to_warehouse_name: "", mode: "quantity", reason: "", notes: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const layoutQuery = useResolvedRecordLayout(`inventory_${kind}`, "full_form");
  const mode = header.mode;
  const fromKey = kind === "adjustments" ? "warehouse_id" : "from_warehouse_id";
  const warehouseId = header[fromKey];
  const toWarehouseId = header.to_warehouse_id;
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [error, setError] = useState<string | null>(null);
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const doc = query.data;
  const title = kind === "adjustments" ? "Adjustment" : "Transfer";
  const base = `/dashboard/inventory/${kind}`;
  const editable = documentId === null ? Boolean(actions?.can_create) : doc?.status === "draft" && Boolean(actions?.can_edit);
  const activeWarehouses = warehouses.data?.filter((row) => row.is_active) ?? [];

  useEffect(() => {
    if (!doc || loadedId === doc.id) return;
    setLoadedId(doc.id);
    setHeader({
      warehouse_id: doc.warehouse_id ?? null, warehouse_name: doc.warehouse_name ?? "",
      from_warehouse_id: doc.from_warehouse_id ?? null, from_warehouse_name: doc.from_warehouse_name ?? "",
      to_warehouse_id: doc.to_warehouse_id ?? null, to_warehouse_name: doc.to_warehouse_name ?? "",
      mode: doc.mode ?? "quantity", reason: doc.reason ?? "", notes: doc.notes ?? "",
    });
    setCustomValues(doc.custom_fields ?? {});
    setLines(doc.lines?.map((line) => ({ key: nextKey++, productId: line.product_id, name: line.product_name,
      value: kind === "transfers" ? line.quantity ?? "" : doc.mode === "count" ? line.counted ?? "" : line.delta ?? "",
      expected: line.expected ?? null, unitCost: line.unit_cost ?? "" })) ?? [blankLine()]);
  }, [doc, kind, loadedId]);

  const updateLine = (updated: DraftLine) => setLines((current) => current.map((line) => line.key === updated.key ? updated : line));
  /** A new warehouse re-reads each line's expected stock; a new type starts the quantities over. */
  function changeHeader(next: InventoryHeader) {
    if (next.mode !== header.mode) setLines((current) => current.map((line) => ({ ...line, value: "", expected: null })));
    else if (next[fromKey] !== header[fromKey]) setLines((current) => current.map((line) => ({ ...line, expected: null })));
    setHeader(next);
  }
  function renderField(field: ResolvedRecordLayoutField, context: RecordFormFieldContext) {
    if (field.field_key !== "mode") return undefined;
    return (
      <QuickCreateField field={field} aria={context.aria} error={context.error}>
        <Select value={header.mode} onValueChange={(value) => context.set({ mode: value })} disabled={context.disabled}>
          <SelectTrigger id={context.inputId} aria-invalid={context.aria.invalid || undefined} aria-describedby={context.aria.describedBy}><SelectValue /></SelectTrigger>
          <SelectContent>{MODES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
        </Select>
      </QuickCreateField>
    );
  }
  const lineWarehouseId = warehouseId ?? activeWarehouses.find((row) => row.is_default)?.id ?? null;
  async function save() {
    const from = warehouseId ?? activeWarehouses.find((row) => row.is_default)?.id;
    // The warehouse select shows the default while the field is blank; it is what is saved.
    const filled = { ...header, [fromKey]: from ?? null };
    const nextErrors = layoutQuery.data ? validateLayoutDrivenQuickCreate(layoutQuery.data, filled, customValues) : {};
    if (!from && !nextErrors[fromKey]) nextErrors[fromKey] = "Choose a warehouse.";
    if (kind === "transfers" && toWarehouseId && toWarehouseId === from) nextErrors.to_warehouse_id = "Choose a different warehouse from the one stock leaves.";
    if (kind === "adjustments" && !header.reason.trim() && !nextErrors.reason) nextErrors.reason = "Enter a reason.";
    setFieldErrors(nextErrors);
    const firstInvalid = Object.keys(nextErrors)[0];
    if (firstInvalid || !from) {
      setError("Check the highlighted fields.");
      if (firstInvalid) document.getElementById(firstInvalid.startsWith("custom:") ? `custom-field-inventory_${kind}-${firstInvalid.slice(7)}` : inventoryInputId(firstInvalid))?.focus();
      return;
    }
    if (!lines.length || lines.some((line) => !line.productId || !line.value.trim() || !Number.isFinite(Number(line.value)) ||
      (kind === "transfers" && Number(line.value) <= 0) || (kind === "adjustments" && mode === "count" && Number(line.value) < 0) ||
      (kind === "adjustments" && mode === "quantity" && Number(line.value) === 0))) {
      setError("Choose a tracked product and enter a valid quantity on every line."); return;
    }
    const ids = lines.map((line) => line.productId);
    if (new Set(ids).size !== ids.length) { setError("A product can appear only once."); return; }
    const payload = kind === "adjustments"
      ? { custom_fields: customValues, warehouse_id: from, mode, reason: header.reason.trim(), notes: header.notes.trim() || null,
          lines: lines.map((line) => ({ product_id: line.productId!, ...(mode === "count" ? { counted: Number(line.value) } : { delta: Number(line.value) }),
            ...(line.unitCost.trim() && Number.isFinite(Number(line.unitCost)) && Number(line.unitCost) >= 0 ? { unit_cost: Number(line.unitCost) } : {}) })) }
      : { custom_fields: customValues, from_warehouse_id: from, to_warehouse_id: toWarehouseId!, notes: header.notes.trim() || null,
          lines: lines.map((line) => ({ product_id: line.productId!, quantity: Number(line.value) })) };
    try {
      setError(null);
      const saved = await mutations.save({ id: documentId ?? undefined, payload });
      toast.success("Draft saved.");
      if (documentId === null) router.push(`${base}/${saved.id}`);
      else { setLoadedId(null); await query.refetch(); }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Draft could not be saved."); }
  }

  async function post() {
    if (!doc) return;
    const effect = kind === "adjustments" ? `${doc.line_count} product${doc.line_count === 1 ? "" : "s"} in ${doc.warehouse_name}` : `${doc.line_count} product${doc.line_count === 1 ? "" : "s"} from ${doc.from_warehouse_name} to ${doc.to_warehouse_name}`;
    if (!(await confirm({ title: `Post ${doc.number}?`, description: `Posting changes stock for ${effect}. You can reverse it by cancelling; posted lines cannot be edited.`, confirmLabel: "Post document" }))) return;
    try { await mutations.post(doc.id); toast.success(`${title} posted.`); await query.refetch(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Posting failed."); }
  }

  async function cancel() {
    if (!doc || !cancelReason.trim()) { setError("Enter a cancellation reason."); return; }
    try { await mutations.cancel({ id: doc.id, reason: cancelReason.trim() }); setCancelOpen(false); toast.success(`${title} cancelled.`); await query.refetch(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Cancellation failed."); }
  }

  async function remove() {
    if (!doc || !(await confirm({ title: `Remove ${doc.number}?`, description: "This draft can be restored from the document list.", confirmLabel: "Remove draft", variant: "destructive" }))) return;
    try { await mutations.remove(doc.id); toast.success("Draft removed."); router.push(base); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Removal failed."); }
  }

  return <PageShell variant="document" title={doc ? `${title} ${doc.number}` : `New ${title.toLowerCase()}`}
    description={doc ? `${doc.status.charAt(0).toUpperCase()}${doc.status.slice(1)} · ${doc.line_count} products${doc.posted_at ? ` · Posted ${formatDateTime(doc.posted_at)}` : ""}` : "Save a draft, then review and post it."}
    backHref={base} isLoading={documentId !== null ? query.isLoading : modulesLoading}
    isPermissionDenied={isForbiddenError(query.error) || (documentId === null && !modulesLoading && !actions?.can_create)}
    hasError={Boolean(query.error) && !isForbiddenError(query.error)} onRetry={() => void query.refetch()}
    actions={<div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link href={base}>All {kind}</Link></Button>{doc?.status === "draft" && actions?.can_edit ? <Button onClick={() => void post()} disabled={mutations.isSaving}>Post</Button> : null}{doc?.status === "posted" && actions?.can_edit ? <Button variant="outline" onClick={() => { setError(null); setCancelOpen(true); }}>Cancel posting</Button> : null}{doc?.status === "draft" && actions?.can_delete ? <Button variant="destructiveGhost" onClick={() => void remove()}>Remove draft</Button> : null}</div>}>
    {editable ? (
      <LayoutRecordFormBody<InventoryHeader>
        moduleKey={`inventory_${kind}`}
        value={header}
        onChange={changeHeader}
        customValues={customValues}
        onCustomChange={(key, value) => setCustomValues((current) => ({ ...current, [key]: value }))}
        inputId={inventoryInputId}
        action={documentId === null ? "create" : "edit"}
        errors={fieldErrors}
        renderField={renderField}
      />
    ) : doc ? (
      <DocumentDetailHeader
        moduleKey={`inventory_${kind}`}
        record={doc}
        renderValue={(field, value) => (field.field_key === "mode"
          ? MODES.find((item) => item.value === value)?.label
          : undefined)}
      />
    ) : null}
    <section className="space-y-3"><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold text-copy-primary">Products</h2></div>
      {editable ? <LineItemsEditor<DraftLine>
          id={`inventory-${kind}`}
          label="Document products"
          lines={lines}
          lineKey={(line) => line.key}
          onChange={setLines}
          createLine={blankLine}
          addLabel="Add product"
          lineLabel={(line) => line.name || "line"}
          columns={[
            { key: "product", label: "Product", size: "lg", share: 4, render: (line, { index, cellProps }) => {
              const productCell = cellProps("product");
              return <LinkedRecordPicker inputId={`inventory-product-${line.key}`} ariaLabel={`Product, line ${index + 1}`} recordType="inventory_product"
                valueId={line.productId} displayValue={line.name} onDisplayValueChange={(value) => updateLine({ ...line, name: value, productId: null, expected: null })}
                onSelect={(option) => updateLine({ ...line, productId: option.id, name: option.label, expected: null })}
                onClear={() => updateLine({ ...line, productId: null, name: "", expected: null })} placeholder="Search tracked products"
                onInputKeyDown={productCell.onKeyDown}
                inputDataAttributes={{ "data-line-editor": productCell["data-line-editor"], "data-line-row": index, "data-line-field": "product" }} />;
            } },
            ...(kind === "adjustments" && mode === "count" ? [{ key: "expected", label: "Expected", size: "sm" as const, align: "right" as const, share: 1.25,
              render: (line: DraftLine) => <ExpectedCell line={line} kind={kind} mode={mode} warehouseId={lineWarehouseId} /> }] : []),
            { key: "value", label: kind === "transfers" ? "Quantity" : mode === "count" ? "Counted" : "Change", size: "sm", align: "right", share: 1.5,
              render: (line, { index, cellProps }) => <LineNumberInput cellProps={cellProps("value")} step="0.0001" min={kind === "adjustments" && mode === "quantity" ? undefined : "0"}
                ariaLabel={`${kind === "transfers" ? "Quantity" : mode === "count" ? "Counted" : "Change"}, line ${index + 1}`} value={line.value} onChange={(value) => updateLine({ ...line, value })} /> },
            ...(kind === "adjustments" && mode === "count" ? [{ key: "difference", label: "Difference", size: "sm" as const, align: "right" as const, share: 1.25,
              render: (line: DraftLine) => <DifferenceCell line={line} kind={kind} mode={mode} warehouseId={lineWarehouseId} /> }] : []),
            ...(kind === "adjustments" ? [{ key: "unit_cost", label: "Unit cost", size: "sm" as const, align: "right" as const, share: 1.75,
              render: (line: DraftLine, { cellProps }: LineCellContext) => <UnitCostCell line={line} kind={kind} mode={mode} warehouseId={lineWarehouseId}
                cellProps={cellProps("unit_cost")} onChange={(value) => updateLine({ ...line, unitCost: value })} /> }] : []),
          ]}
        />
        : <RecordTable variant="readOnly" label="Document products" rows={doc?.lines ?? []} rowKey={(line) => line.id} emptyState={{ title: "No products" }} columns={[{ key: "product", label: "Product", render: (line) => line.product_name }, { key: "expected", label: kind === "transfers" ? "Quantity" : mode === "count" ? "Expected" : "Change", align: "right", render: (line) => <span className="tabular-nums">{kind === "transfers" ? line.quantity : mode === "count" ? line.expected : line.delta}</span> }, ...(kind === "adjustments" && mode === "count" ? [{ key: "counted", label: "Counted", align: "right" as const, render: (line: NonNullable<InventoryDocument["lines"]>[number]) => <span className="tabular-nums">{line.counted}</span> }, { key: "delta", label: "Difference", align: "right" as const, render: (line: NonNullable<InventoryDocument["lines"]>[number]) => <span className="tabular-nums">{line.delta}</span> }] : []), ...(kind === "adjustments" && doc?.lines?.some((line) => line.unit_cost != null) ? [{ key: "unit_cost", label: "Unit cost", align: "right" as const, render: (line: NonNullable<InventoryDocument["lines"]>[number]) => <span className="tabular-nums">{line.unit_cost ?? "—"}</span> }] : [])]} />}
    </section>
    {doc ? <DocumentHistory moduleKey={kind === "adjustments" ? "inventory_adjustments" : "inventory_transfers"} entityId={doc.id} canEdit={Boolean(actions?.can_edit)} /> : null}
    {editable ? <FormFooter status={error ? <span role="alert" className="text-state-danger">{error}</span> : doc ? "Changes are saved as a draft until posted." : "Posting is available after saving the draft."}><Button type="button" variant="outline" asChild><Link href={base}>Back</Link></Button><Button type="button" onClick={() => void save()} disabled={mutations.isSaving}>{mutations.isSaving ? "Saving…" : "Save draft"}</Button></FormFooter> : error ? <p role="alert" className="text-sm text-state-danger">{error}</p> : null}
    <EditorPanel open={cancelOpen} onOpenChange={setCancelOpen} title={`Cancel ${doc?.number ?? title}`} description="A reversal will return stock to its previous warehouses if enough remains." closeLabel="Close cancellation" onSubmit={() => void cancel()} status={error ? <span role="alert">{error}</span> : null} footer={<><Button variant="outline" onClick={() => setCancelOpen(false)}>Back</Button><Button type="submit" disabled={mutations.isSaving}>Reverse and cancel</Button></>}><Field><FieldLabel htmlFor="inventory-cancel-reason">Reason</FieldLabel><Input id="inventory-cancel-reason" maxLength={120} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></Field></EditorPanel>
  </PageShell>;
}
