"use client";

import { EmptyValue, type EmptyValueContext } from "@/components/ui/EmptyValue";
import { picklistLabel, usePicklist } from "@/hooks/usePicklists";

/** A stored picklist key, drawn as its label; absent, the context's empty value (3.6). */
export function PicklistText({
  listKey,
  value,
  context = "cell",
}: {
  listKey: string;
  value: string | null | undefined;
  context?: EmptyValueContext;
}) {
  const { picklist } = usePicklist(listKey);
  const label = picklistLabel(picklist, value);
  return label ? <>{label}</> : <EmptyValue context={context} />;
}
