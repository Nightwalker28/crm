import { TableCell } from "@/components/ui/Table";
import { getCustomFieldKeyFromColumn } from "@/lib/moduleViewConfigs";
import { cn } from "@/lib/utils";

type Props = {
  column: string;
  values?: Record<string, unknown> | null;
  className?: string;
};

export function CustomFieldCell({ column, values, className }: Props) {
  const fieldKey = getCustomFieldKeyFromColumn(column);
  const value = values?.[fieldKey];
  return (
    <TableCell className={cn(className)}>
      <span className="text-sm text-copy-secondary">
        {value == null || value === "" ? (
          <span className="text-copy-disabled">—</span>
        ) : String(value)}
      </span>
    </TableCell>
  );
}
