"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import { LineItemsEditor, LineNumberInput, type LineCellContext } from "@/components/transactions/LineItemsEditor";
import { FormFooter } from "@/components/ui/ActionBar";
import { Button } from "@/components/ui/button";
import { EditorPanel } from "@/components/ui/EditorPanel";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { RecordTable } from "@/components/ui/RecordTable";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useConfirm } from "@/hooks/useConfirm";
import { useInventoryDocument, useInventoryDocumentActions, useProductStock, useWarehouses, type InventoryDocument, type InventoryKind } from "@/hooks/inventory/useInventory";
import { isForbiddenError } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { RecordCustomFieldsFacts, RecordCustomFieldsSection } from "@/components/customFields/RecordCustomFields";

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
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [toWarehouseId, setToWarehouseId] = useState<number | null>(null);
  const [mode, setMode] = useState<"quantity" | "count">("quantity");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
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
    setWarehouseId(kind === "adjustments" ? doc.warehouse_id ?? null : doc.from_warehouse_id ?? null);
    setToWarehouseId(doc.to_warehouse_id ?? null);
    setMode(doc.mode ?? "quantity");
    setReason(doc.reason ?? ""); setNotes(doc.notes ?? "");
    setCustomValues(doc.custom_fields ?? {});
    setLines(doc.lines?.map((line) => ({ key: nextKey++, productId: line.product_id, name: line.product_name,
      value: kind === "transfers" ? line.quantity ?? "" : doc.mode === "count" ? line.counted ?? "" : line.delta ?? "",
      expected: line.expected ?? null, unitCost: line.unit_cost ?? "" })) ?? [blankLine()]);
  }, [doc, kind, loadedId]);

  const updateLine = (updated: DraftLine) => setLines((current) => current.map((line) => line.key === updated.key ? updated : line));
  const lineWarehouseId = warehouseId ?? activeWarehouses.find((row) => row.is_default)?.id ?? null;
  async function save() {
    const from = warehouseId ?? activeWarehouses.find((row) => row.is_default)?.id;
    if (!from || (kind === "transfers" && (!toWarehouseId || toWarehouseId === from)) || (kind === "adjustments" && !reason.trim())) {
      setError(kind === "transfers" ? "Choose two different warehouses." : "Choose a warehouse and enter a reason."); return;
    }
    if (!lines.length || lines.some((line) => !line.productId || !line.value.trim() || !Number.isFinite(Number(line.value)) ||
      (kind === "transfers" && Number(line.value) <= 0) || (kind === "adjustments" && mode === "count" && Number(line.value) < 0) ||
      (kind === "adjustments" && mode === "quantity" && Number(line.value) === 0))) {
      setError("Choose a tracked product and enter a valid quantity on every line."); return;
    }
    const ids = lines.map((line) => line.productId);
    if (new Set(ids).size !== ids.length) { setError("A product can appear only once."); return; }
    const payload = kind === "adjustments"
      ? { custom_fields: customValues, warehouse_id: from, mode, reason: reason.trim(), notes: notes.trim() || null,
          lines: lines.map((line) => ({ product_id: line.productId!, ...(mode === "count" ? { counted: Number(line.value) } : { delta: Number(line.value) }),
            ...(line.unitCost.trim() && Number.isFinite(Number(line.unitCost)) && Number(line.unitCost) >= 0 ? { unit_cost: Number(line.unitCost) } : {}) })) }
      : { custom_fields: customValues, from_warehouse_id: from, to_warehouse_id: toWarehouseId!, notes: notes.trim() || null,
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
    <div className="grid gap-6 lg:grid-cols-2">
      <Field><FieldLabel>{kind === "adjustments" ? "Warehouse" : "From warehouse"}</FieldLabel><Select value={String(warehouseId ?? activeWarehouses.find((row) => row.is_default)?.id ?? "")} onValueChange={(value) => { setWarehouseId(Number(value)); setLines((current) => current.map((line) => ({ ...line, expected: null }))); }} disabled={!editable}><SelectTrigger aria-label={kind === "adjustments" ? "Warehouse" : "From warehouse"}><SelectValue placeholder="Select warehouse" /></SelectTrigger><SelectContent>{activeWarehouses.map((row) => <SelectItem key={row.id} value={String(row.id)}>{row.name}</SelectItem>)}</SelectContent></Select></Field>
      {kind === "transfers" ? <Field><FieldLabel>To warehouse</FieldLabel><Select value={String(toWarehouseId ?? "")} onValueChange={(value) => setToWarehouseId(Number(value))} disabled={!editable}><SelectTrigger aria-label="To warehouse"><SelectValue placeholder="Select warehouse" /></SelectTrigger><SelectContent>{activeWarehouses.map((row) => <SelectItem key={row.id} value={String(row.id)}>{row.name}</SelectItem>)}</SelectContent></Select></Field> : <Field><FieldLabel>Type</FieldLabel><Select value={mode} onValueChange={(value) => { setMode(value as "quantity" | "count"); setLines((current) => current.map((line) => ({ ...line, value: "", expected: null }))); }} disabled={!editable}><SelectTrigger aria-label="Adjustment type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="quantity">Quantity change</SelectItem><SelectItem value="count">Physical count</SelectItem></SelectContent></Select></Field>}
      {kind === "adjustments" ? <Field><FieldLabel htmlFor="inventory-reason">Reason</FieldLabel><Input id="inventory-reason" maxLength={120} value={reason} onChange={(event) => setReason(event.target.value)} disabled={!editable} /></Field> : null}
      <Field><FieldLabel htmlFor="inventory-notes">Notes</FieldLabel><Textarea id="inventory-notes" value={notes} onChange={(event) => setNotes(event.target.value)} disabled={!editable} /></Field>
    </div>
    {editable ? <RecordCustomFieldsSection moduleKey={`inventory_${kind}`} values={customValues} onChange={setCustomValues} />
      : doc ? <RecordCustomFieldsFacts moduleKey={`inventory_${kind}`} values={doc.custom_fields} /> : null}
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
    {editable ? <FormFooter status={error ? <span role="alert" className="text-state-danger">{error}</span> : doc ? "Changes are saved as a draft until posted." : "Posting is available after saving the draft."}><Button type="button" variant="outline" asChild><Link href={base}>Back</Link></Button><Button type="button" onClick={() => void save()} disabled={mutations.isSaving}>{mutations.isSaving ? "Saving…" : "Save draft"}</Button></FormFooter> : error ? <p role="alert" className="text-sm text-state-danger">{error}</p> : null}
    <EditorPanel open={cancelOpen} onOpenChange={setCancelOpen} title={`Cancel ${doc?.number ?? title}`} description="A reversal will return stock to its previous warehouses if enough remains." closeLabel="Close cancellation" onSubmit={() => void cancel()} status={error ? <span role="alert">{error}</span> : null} footer={<><Button variant="outline" onClick={() => setCancelOpen(false)}>Back</Button><Button type="submit" disabled={mutations.isSaving}>Reverse and cancel</Button></>}><Field><FieldLabel htmlFor="inventory-cancel-reason">Reason</FieldLabel><Input id="inventory-cancel-reason" maxLength={120} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></Field></EditorPanel>
  </PageShell>;
}
