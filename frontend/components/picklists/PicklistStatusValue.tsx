"use client";

import { StatusValue, type StatusContext } from "@/components/ui/StatusValue";
import { picklistStatus, usePicklist } from "@/hooks/usePicklists";

/** A logic-bearing picklist value (lead status) as a status, in the tone its admin gave it. */
export function PicklistStatusValue({
  listKey,
  value,
  context = "list",
}: {
  listKey: string;
  value: string | null | undefined;
  context?: StatusContext;
}) {
  const { picklist } = usePicklist(listKey);
  return <StatusValue status={picklistStatus(picklist, value)} context={context} />;
}
