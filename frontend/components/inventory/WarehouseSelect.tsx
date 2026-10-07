"use client";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWarehouses } from "@/hooks/inventory/useInventory";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";

/**
 * A warehouse field on a document header (13b Phase 4e). The list needs stock access; a user
 * without it sees the document's warehouse by name and cannot change it, which is what the
 * server allows them anyway. Empty means the default warehouse, which the select shows —
 * except for a destination (`emptyMeansDefault={false}`), which is never assumed.
 */
export function WarehouseSelect({
  id,
  value,
  name,
  onChange,
  disabled,
  ariaInvalid,
  ariaDescribedBy,
  emptyMeansDefault = true,
}: {
  id: string;
  value: number | null;
  /** The document's warehouse name, shown when the list cannot be read. */
  name?: string | null;
  onChange: (id: number, name: string) => void;
  disabled?: boolean;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
  emptyMeansDefault?: boolean;
}) {
  const { modules } = useAccessibleModules();
  const canViewStock = Boolean(modules.find((module) => module.name === "inventory_stock")?.actions?.can_view);
  const warehouses = useWarehouses(false, canViewStock);
  const active = warehouses.data?.filter((row) => row.is_active || row.id === value) ?? [];
  const current = value ?? (emptyMeansDefault ? active.find((row) => row.is_default)?.id ?? null : null);

  if (!canViewStock || disabled || !active.length) {
    const label = active.find((row) => row.id === current)?.name ?? name ?? (value === null && emptyMeansDefault ? "Default warehouse" : "");
    return (
      <Input
        id={id}
        value={label}
        readOnly
        disabled
        aria-invalid={ariaInvalid || undefined}
        aria-describedby={ariaDescribedBy}
      />
    );
  }
  return (
    <Select
      value={current === null ? "" : String(current)}
      onValueChange={(next) => {
        const row = active.find((item) => String(item.id) === next);
        if (row) onChange(row.id, row.name);
      }}
    >
      <SelectTrigger id={id} aria-invalid={ariaInvalid || undefined} aria-describedby={ariaDescribedBy}>
        <SelectValue placeholder="Select warehouse" />
      </SelectTrigger>
      <SelectContent>
        {active.map((row) => (
          <SelectItem key={row.id} value={String(row.id)}>
            {row.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
