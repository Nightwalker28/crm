"use client";

import { useState } from "react";
import { Warehouse as WarehouseIcon, Plus, Pencil, Trash2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EditorPanel } from "@/components/ui/EditorPanel";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { RecordTable } from "@/components/ui/RecordTable";
import { Textarea } from "@/components/ui/textarea";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useInventoryActions, useWarehouses, type Warehouse } from "@/hooks/inventory/useInventory";
import { useConfirm } from "@/hooks/useConfirm";
import { isForbiddenError } from "@/lib/api";
import { SETTINGS_ROUTES } from "@/lib/routes";

type Draft = { code: string; name: string; address: string; is_active: boolean };
const EMPTY: Draft = { code: "", name: "", address: "", is_active: true };

export default function WarehousesSettingsPage() {
  const { modules } = useAccessibleModules();
  const canConfigure = Boolean(modules.find((module) => module.name === "inventory_stock")?.actions?.can_configure);
  const [showRemoved, setShowRemoved] = useState(false);
  const query = useWarehouses(showRemoved && canConfigure);
  const { saveWarehouse, removeWarehouse, restoreWarehouse, isSaving } = useInventoryActions();
  const { confirm } = useConfirm();
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  function edit(warehouse: Warehouse | null) {
    setEditing(warehouse);
    setDraft(warehouse ? { code: warehouse.code, name: warehouse.name, address: warehouse.address ?? "", is_active: warehouse.is_active } : EMPTY);
    setError(null);
    setOpen(true);
  }

  async function save() {
    if (!draft.code.trim() || !draft.name.trim()) { setError("Enter a code and name."); return; }
    try {
      setError(null);
      await saveWarehouse({ id: editing?.id, payload: { code: draft.code.trim().toUpperCase(), name: draft.name.trim(), address: draft.address.trim() || null, is_active: draft.is_active } });
      toast.success(editing ? "Warehouse updated." : "Warehouse created.");
      setOpen(false);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Warehouse could not be saved."); }
  }

  async function remove(warehouse: Warehouse) {
    if (!(await confirm({ title: `Remove ${warehouse.name}?`, description: "Warehouses with stock or movement history must be deactivated instead.", confirmLabel: "Remove warehouse", variant: "destructive" }))) return;
    try { await removeWarehouse(warehouse.id); toast.success("Warehouse removed."); }
    catch (failure) { toast.error(failure instanceof Error ? failure.message : "Warehouse could not be removed."); }
  }

  async function restore(warehouse: Warehouse) {
    try { await restoreWarehouse(warehouse.id); toast.success("Warehouse restored."); }
    catch (failure) { toast.error(failure instanceof Error ? failure.message : "Warehouse could not be restored."); }
  }

  return <PageShell variant="settings" title="Warehouses" description="Manage the places where tracked products are stored. Main is the default warehouse." backHref={SETTINGS_ROUTES.root}
    actions={canConfigure ? <Button onClick={() => edit(null)}><Plus />Add warehouse</Button> : null}
    isPermissionDenied={isForbiddenError(query.error)}>
    {canConfigure ? <Button variant="outline" size="sm" onClick={() => setShowRemoved((value) => !value)}>{showRemoved ? "Hide removed" : "Show removed"}</Button> : null}
    <RecordTable label="Warehouses" rows={query.data ?? []} rowKey={(row) => row.id} variant="readOnly"
      isLoading={query.isLoading} hasError={Boolean(query.error) && !isForbiddenError(query.error)} onRetry={() => void query.refetch()}
      emptyState={{ icon: WarehouseIcon, title: "No warehouses", description: "Main is created automatically when inventory starts." }}
      columns={[{ key: "name", label: "Warehouse", size: "lg", render: (row) => <span className="font-semibold text-copy-primary">{row.name}</span> }, { key: "code", label: "Code", render: (row) => row.code }, { key: "address", label: "Address", render: (row) => row.address || "—" }, { key: "state", label: "State", render: (row) => row.is_deleted ? "Removed" : row.is_default ? "Default" : row.is_active ? "Active" : "Inactive" }]}
      rowActions={canConfigure ? (row) => row.is_deleted ? <Button variant="ghost" size="icon" aria-label={`Restore ${row.name}`} onClick={() => void restore(row)}><RotateCcw /></Button> : <div className="flex gap-1"><Button variant="ghost" size="icon" aria-label={`Edit ${row.name}`} onClick={() => edit(row)}><Pencil /></Button>{!row.is_default ? <Button variant="destructiveGhost" size="icon" aria-label={`Remove ${row.name}`} onClick={() => void remove(row)}><Trash2 /></Button> : null}</div> : undefined} />
    <EditorPanel open={open} onOpenChange={setOpen} title={editing ? "Edit warehouse" : "Add warehouse"} description="Codes identify warehouses on stock documents." closeLabel="Close warehouse editor" onSubmit={() => void save()} status={error ? <span role="alert">{error}</span> : null}
      footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={isSaving}>{isSaving ? "Saving…" : "Save warehouse"}</Button></>}>
      <div className="grid gap-4">
        <Field><FieldLabel htmlFor="warehouse-code">Code</FieldLabel><Input id="warehouse-code" maxLength={40} value={draft.code} onChange={(event) => setDraft((current) => ({ ...current, code: event.target.value.toUpperCase() }))} /></Field>
        <Field><FieldLabel htmlFor="warehouse-name">Name</FieldLabel><Input id="warehouse-name" maxLength={120} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></Field>
        <Field><FieldLabel htmlFor="warehouse-address">Address</FieldLabel><Textarea id="warehouse-address" value={draft.address} onChange={(event) => setDraft((current) => ({ ...current, address: event.target.value }))} /></Field>
        {!editing?.is_default ? <label className="flex items-center gap-2 text-sm text-copy-secondary"><Checkbox checked={draft.is_active} onCheckedChange={(value) => setDraft((current) => ({ ...current, is_active: value === true }))} />Active</label> : null}
      </div>
    </EditorPanel>
  </PageShell>;
}
