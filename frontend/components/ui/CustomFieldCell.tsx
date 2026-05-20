import { TableCell } from "@/components/ui/Table";
import { getCustomFieldKeyFromColumn } from "@/lib/moduleViewConfigs";

type Props = {
  column: string;
  values?: Record<string, unknown> | null;
};

export function CustomFieldCell({ column, values }: Props) {
  const fieldKey = getCustomFieldKeyFromColumn(column);
  const value = values?.[fieldKey];
  return (
    <TableCell>
      <span className="text-sm text-neutral-300">
        {value == null || value === "" ? (
          <span className="text-neutral-600">—</span>
        ) : String(value)}
      </span>
    </TableCell>
  );
}
