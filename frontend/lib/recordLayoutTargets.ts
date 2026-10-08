import type { RecordLayoutSurface } from "@/lib/contracts/recordLayouts";

/**
 * The modules and surfaces Settings → Record layouts can edit (13b Phase 4 slice 4d). Mirrors
 * `SUPPORTED_LAYOUT_SURFACES_BY_MODULE` in backend `record_layouts.py`; the server is the
 * boundary and refuses anything else.
 */
export type RecordLayoutTarget = { moduleKey: string; label: string; surfaces: RecordLayoutSurface[] };

/** Modules with a quick create: the CRM records, and products and services (13b Phase 5). */
const CRM: RecordLayoutSurface[] = ["quick_create", "full_form", "detail"];
const FORM_AND_DETAIL: RecordLayoutSurface[] = ["full_form", "detail"];

export const RECORD_LAYOUT_TARGETS: RecordLayoutTarget[] = [
  { moduleKey: "sales_leads", label: "Leads", surfaces: CRM },
  { moduleKey: "sales_contacts", label: "Contacts", surfaces: CRM },
  { moduleKey: "sales_organizations", label: "Accounts", surfaces: CRM },
  { moduleKey: "sales_opportunities", label: "Deals", surfaces: CRM },
  { moduleKey: "sales_quotes", label: "Quotes", surfaces: FORM_AND_DETAIL },
  { moduleKey: "sales_orders", label: "Orders", surfaces: FORM_AND_DETAIL },
  { moduleKey: "finance_pos", label: "Invoices", surfaces: FORM_AND_DETAIL },
  { moduleKey: "finance_credit_notes", label: "Credit notes", surfaces: FORM_AND_DETAIL },
  { moduleKey: "finance_payments", label: "Payments", surfaces: FORM_AND_DETAIL },
  { moduleKey: "catalog_products", label: "Products", surfaces: CRM },
  { moduleKey: "catalog_services", label: "Services", surfaces: CRM },
  { moduleKey: "purchase_orders", label: "Purchase orders", surfaces: FORM_AND_DETAIL },
  { moduleKey: "purchase_receipts", label: "Receipts", surfaces: FORM_AND_DETAIL },
  { moduleKey: "purchase_bills", label: "Bills", surfaces: FORM_AND_DETAIL },
  { moduleKey: "purchase_vendor_returns", label: "Vendor returns", surfaces: FORM_AND_DETAIL },
  { moduleKey: "purchase_vendor_credits", label: "Vendor credits", surfaces: FORM_AND_DETAIL },
  { moduleKey: "inventory_deliveries", label: "Deliveries", surfaces: FORM_AND_DETAIL },
  { moduleKey: "inventory_returns", label: "Returns", surfaces: FORM_AND_DETAIL },
  { moduleKey: "inventory_adjustments", label: "Stock adjustments", surfaces: FORM_AND_DETAIL },
  { moduleKey: "inventory_transfers", label: "Stock transfers", surfaces: FORM_AND_DETAIL },
];

export const RECORD_LAYOUT_SURFACE_LABELS: Record<RecordLayoutSurface, string> = {
  quick_create: "Quick create",
  full_form: "Full form",
  detail: "Details",
};

export function recordLayoutTarget(moduleKey: string) {
  return RECORD_LAYOUT_TARGETS.find((target) => target.moduleKey === moduleKey) ?? RECORD_LAYOUT_TARGETS[0];
}
