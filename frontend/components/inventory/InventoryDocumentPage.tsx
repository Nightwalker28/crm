"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
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

type DraftLine = { key: number; productId: number | null; name: string; value: string; expected: string | null };
let nextKey = 1;
const blankLine = (): DraftLine => ({ key: nextKey++, productId: null, name: "", value: "", expected: null });

function LineEditor({ line, kind, mode, warehouseId, onChange, onRemove }: {
  line: DraftLine; kind: InventoryKind; mode: "quantity" | "count"; warehouseId: number | null;
  onChange: (line: DraftLine) => void; onRemove: () => void;
}) {
  const stock = useProductStock(line.productId);
  const current = stock.data?.warehouses.find((row) => row.id === warehouseId)?.on_hand ?? "0";
  const expected = line.expected ?? current;
  const difference = kind === "adjustments" && mode === "count" && line.value !== "" ? Number(line.value) - Number(expected) : null;
  return <div className="grid gap-3 border-b border-line-subtle py-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
    <Field><FieldLabel htmlFor={`inventory-product-${line.key}`}>Product</FieldLabel><LinkedRecordPicker inputId={`inventory-product-${line.key}`} recordType="inventory_product"
      valueId={line.productId} displayValue={line.name} onDisplayValueChange={(value) => onChange({ ...line, name: value, productId: null, expected: null })}
      onSelect={(option) => onChange({ ...line, productId: option.id, name: option.label, expected: null })}
      onClear={() => onChange({ ...line, productId: null, name: "", expected: null })} placeholder="Search tracked products" /></Field>
    {kind === "adjustments" && mode === "count" ? <div className="text-sm text-copy-secondary"><span className="block text-copy-label">Expected</span><span className="tabular-nums">{Number(expected).toLocaleString()}</span></div> : <div className="hidden md:block" />}
    <Field><FieldLabel htmlFor={`inventory-quantity-${line.key}`}>{kind === "transfers" ? "Quantity" : mode === "count" ? "Counted" : "Change"}</FieldLabel><Input id={`inventory-quantity-${line.key}`} type="number" step="0.0001" value={line.value} onChange={(event) => onChange({ ...line, value: event.target.value })} /></Field>
    <div className="flex items-center gap-2">{difference !== null ? <span className="text-sm tabular-nums text-copy-secondary" aria-label="Difference">{difference > 0 ? "+" : ""}{difference}</span> : null}<Button type="button" variant="ghost" size="icon" aria-label={`Remove ${line.name || "line"}`} onClick={onRemove}><Trash2 /></Button></div>
  </div>;
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
    setLines(doc.lines?.map((line) => ({ key: nextKey++, productId: line.product_id, name: line.product_name,
      value: kind === "transfers" ? line.quantity ?? "" : doc.mode === "count" ? line.counted ?? "" : line.delta ?? "",
      expected: line.expected ?? null })) ?? [blankLine()]);
  }, [doc, kind, loadedId]);

  const updateLine = (updated: DraftLine) => setLines((current) => current.map((line) => line.key === updated.key ? updated : line));
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
      ? { warehouse_id: from, mode, reason: reason.trim(), notes: notes.trim() || null,
          lines: lines.map((line) => ({ product_id: line.productId!, ...(mode === "count" ? { counted: Number(line.value) } : { delta: Number(line.value) }) })) }
      : { from_warehouse_id: from, to_warehouse_id: toWarehouseId!, notes: notes.trim() || null,
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
    <section className="space-y-3"><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold text-copy-primary">Products</h2>{editable ? <Button type="button" variant="outline" size="sm" onClick={() => setLines((current) => [...current, blankLine()])}><Plus />Add product</Button> : null}</div>
      {editable ? <div>{lines.map((line) => <LineEditor key={line.key} line={line} kind={kind} mode={mode} warehouseId={warehouseId ?? activeWarehouses.find((row) => row.is_default)?.id ?? null} onChange={updateLine} onRemove={() => setLines((current) => current.filter((item) => item.key !== line.key))} />)}</div>
        : <RecordTable variant="readOnly" label="Document products" rows={doc?.lines ?? []} rowKey={(line) => line.id} emptyState={{ title: "No products" }} columns={[{ key: "product", label: "Product", render: (line) => line.product_name }, { key: "expected", label: kind === "transfers" ? "Quantity" : mode === "count" ? "Expected" : "Change", align: "right", render: (line) => <span className="tabular-nums">{kind === "transfers" ? line.quantity : mode === "count" ? line.expected : line.delta}</span> }, ...(kind === "adjustments" && mode === "count" ? [{ key: "counted", label: "Counted", align: "right" as const, render: (line: NonNullable<InventoryDocument["lines"]>[number]) => <span className="tabular-nums">{line.counted}</span> }, { key: "delta", label: "Difference", align: "right" as const, render: (line: NonNullable<InventoryDocument["lines"]>[number]) => <span className="tabular-nums">{line.delta}</span> }] : [])]} />}
    </section>
    {editable ? <FormFooter status={error ? <span role="alert" className="text-state-danger">{error}</span> : doc ? "Changes are saved as a draft until posted." : "Posting is available after saving the draft."}><Button type="button" variant="outline" asChild><Link href={base}>Back</Link></Button><Button type="button" onClick={() => void save()} disabled={mutations.isSaving}>{mutations.isSaving ? "Saving…" : "Save draft"}</Button></FormFooter> : error ? <p role="alert" className="text-sm text-state-danger">{error}</p> : null}
    <EditorPanel open={cancelOpen} onOpenChange={setCancelOpen} title={`Cancel ${doc?.number ?? title}`} description="A reversal will return stock to its previous warehouses if enough remains." closeLabel="Close cancellation" onSubmit={() => void cancel()} status={error ? <span role="alert">{error}</span> : null} footer={<><Button variant="outline" onClick={() => setCancelOpen(false)}>Back</Button><Button type="submit" disabled={mutations.isSaving}>Reverse and cancel</Button></>}><Field><FieldLabel htmlFor="inventory-cancel-reason">Reason</FieldLabel><Input id="inventory-cancel-reason" maxLength={120} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></Field></EditorPanel>
  </PageShell>;
}
