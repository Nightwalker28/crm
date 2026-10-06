import { apiFetch } from "@/lib/api";

/** What *Create quote* and *Create order* on a deal carry into the new document (13a H13). */
export type DealForDocument = {
  opportunity_id: number;
  opportunity_name: string;
  organization_id?: number | null;
  organization_name?: string | null;
  contact_id?: number | null;
  contact_name?: string | null;
  currency_type?: string | null;
};

/** The deal behind `?opportunity_id=`, or `null` when it is gone or not visible — the form
 *  then opens empty rather than failing. */
export async function fetchDealForDocument(dealId: string): Promise<DealForDocument | null> {
  const res = await apiFetch(`/sales/opportunities/${encodeURIComponent(dealId)}`);
  if (!res.ok) return null;
  return (await res.json().catch(() => null)) as DealForDocument | null;
}
