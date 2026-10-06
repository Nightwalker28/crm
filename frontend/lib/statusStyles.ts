import { formatSnakeCaseLabel } from "@/lib/module-display";

/**
 * What an enum value *means*, never how it looks.
 *
 * This file used to return raw Tailwind strings — `{bg, text, border, label}` — which is why
 * 52 files re-derived colour at the call site and why roughly 85% of all enum values rendered
 * as a coloured chip. R5 (docs/design/rebuild.md) rules that **colour marks exception, not
 * state**: an operator scanning a list is looking for problems, and a green "Paid" on 90% of
 * rows is 90% noise that makes the 5% needing attention harder to find.
 *
 * The split is strict and it is the whole point:
 *
 * - **this file owns which values carry which tone** — a judgement call per field, made once
 *   in `rebuild.md` 5.0 across 62 values in 13 maps;
 * - **`StatusValue` owns how a tone looks in a given context** — plain ink in a list, semantic
 *   colour on a record header.
 *
 * Nothing else participates, and **no call site ever names a colour**. That is what keeps the
 * two foreseeable changes cheap: reclassifying a value is one line here, and switching lists
 * to the dot treatment is one component. Today the same change would be a 52-file sweep.
 *
 * `success` is classified from day one even though a list currently renders it as plain ink.
 * Defining only neutral/attention/critical would make "colour the signed states green" a
 * *type* change rippling through every map and every switch; classified-but-unpainted costs
 * nothing now and makes that decision permanently free.
 */

export type StatusTone = "neutral" | "success" | "attention" | "critical";

/**
 * `tone: null` means the field is a **category, not a status** — no value is an outcome and
 * none is a deviation, so it never takes colour in any context. Lead score grade
 * (hot/warm/cold) and task priority are the two: an operator finds hot leads by sorting the
 * column, which is what a list is for, and a task's priority is set by whoever made the task.
 *
 * Support case priority is the deliberate contrast — it drives response time, so it *is*
 * effectively an SLA and it keeps a tone.
 */
export type StatusDescriptor = { tone: StatusTone | null; label: string };

/**
 * Sentence case, per design.md 3.5 and 3.6.
 *
 * The previous helper title-cased every unmapped value and the maps hard-coded "Closed Won",
 * "In Progress" and "To Do" — so sentence case was broken on strings that reach every list
 * page in the app, by a helper rather than by a designer.
 *
 * The raw value is lowercased first because a status can arrive shouted ("IN_PROGRESS");
 * the label itself comes from `formatSnakeCaseLabel`, the one key-to-label function.
 */
function labelize(value: string): string {
  return formatSnakeCaseLabel(value.toLowerCase()) || "Unknown";
}

function descriptorFrom(
  map: Record<string, StatusDescriptor>,
  value: string | null | undefined,
  fallback: StatusDescriptor = { tone: "neutral", label: "Unknown" },
): StatusDescriptor {
  const raw = (value ?? "").trim();
  if (!raw) return fallback;
  const key = raw.toLowerCase().replace(/\s+/g, "_");
  return map[key] ?? { tone: fallback.tone, label: labelize(raw) };
}

const n = (label: string): StatusDescriptor => ({ tone: "neutral", label });
const s = (label: string): StatusDescriptor => ({ tone: "success", label });
const a = (label: string): StatusDescriptor => ({ tone: "attention", label });
const c = (label: string): StatusDescriptor => ({ tone: "critical", label });
/** A category: no tone, in any context. */
const cat = (label: string): StatusDescriptor => ({ tone: null, label });

export function getGenericStatus(value: string): StatusDescriptor {
  return { tone: "neutral", label: labelize(value || "Unknown") };
}

/**
 * `in_stock` is neutral rather than success on purpose: it is the state most rows are in, and
 * R5's whole point is that painting the normal case leaves nothing for the exception. Out of
 * stock is what an operator scanning the catalog is looking for.
 */
const CATALOG_STOCK_STATUS: Record<string, StatusDescriptor> = {
  untracked: n("Untracked"),
  in_stock: n("In stock"),
  out_of_stock: c("Out of stock"),
  preorder: a("Preorder"),
};

// E5 (12c-erp-invoicing.md §3.3): draft → issued → void. Whether it is paid is the payment
// status; overdue is derived and passed as a tone by the caller.
const POS_INVOICE_STATUS: Record<string, StatusDescriptor> = {
  draft: n("Draft"),
  issued: n("Issued"),
  void: c("Void"),
};

const POS_PAYMENT_STATUS: Record<string, StatusDescriptor> = {
  // `unpaid` and `partial` are the *normal* state of a recent invoice, so colouring them makes
  // an AR list mostly amber and re-creates exactly the noise R5 removes. What deserves
  // attention is **overdue**, which is derived (`due_date < today && status !== "paid"`) rather
  // than an enum value — the caller computes it and passes `tone` to `StatusValue` directly.
  unpaid: n("Unpaid"),
  partial: n("Partially paid"),
  paid: s("Paid"),
};

const ORDER_INVOICE_STATUS: Record<string, StatusDescriptor> = {
  none: n("Not invoiced"),
  pending: n("Awaiting delivery"),
  // Something delivered (or ordered) is not invoiced yet: money waiting to be asked for.
  to_invoice: a("To invoice"),
  partial: n("Partly invoiced"),
  invoiced: s("Invoiced"),
};

const CREDIT_NOTE_STATUS: Record<string, StatusDescriptor> = {
  draft: n("Draft"),
  issued: n("Issued"),
  void: c("Void"),
};

const PAYMENT_RECORD_STATUS: Record<string, StatusDescriptor> = {
  posted: n("Posted"),
  void: c("Void"),
};

const BILL_STATUS: Record<string, StatusDescriptor> = {
  draft: n("Draft"),
  posted: n("Posted"),
  void: c("Void"),
};

const BILL_MATCH_STATUS: Record<string, StatusDescriptor> = {
  none: n("No purchase order"),
  matched: n("Matches purchase order"),
  variance: a("Price differs from purchase order"),
};

const PURCHASE_ORDER_BILL_STATUS: Record<string, StatusDescriptor> = {
  none: n("Not billed"),
  to_bill: a("To bill"),
  partial: n("Partly billed"),
  billed: s("Billed"),
};


const LEAD_SCORE_GRADE: Record<string, StatusDescriptor> = {
  hot: cat("Hot"),
  warm: cat("Warm"),
  cold: cat("Cold"),
};

const QUOTE_STATUS: Record<string, StatusDescriptor> = {
  draft: n("Draft"),
  sent: n("Sent"),
  accepted: s("Accepted"),
  expired: a("Expired"),
  declined: c("Declined"),
};

const ORDER_STATUS: Record<string, StatusDescriptor> = {
  draft: n("Draft"),
  confirmed: n("Confirmed"),
  fulfilled: s("Fulfilled"),
  cancelled: c("Cancelled"),
};

/** Where an order came from — a category, so toneless (R5). */
const ORDER_SOURCE: Record<string, StatusDescriptor> = {
  crm: cat("CRM"),
  website: cat("Website"),
  client_portal: cat("Client portal"),
};

/** The same order seen by the client in the portal: a draft is one the team has not confirmed. */
const CLIENT_ORDER_STATUS: Record<string, StatusDescriptor> = {
  ...ORDER_STATUS,
  draft: n("Awaiting confirmation"),
};

/**
 * Whether a confirmed order's stock is held. *Reserved* is the expected state; a line still
 * waiting for stock is the exception an operator scans for.
 */
const ORDER_AVAILABILITY: Record<string, StatusDescriptor> = {
  reserved: n("Reserved"),
  partly_reserved: a("Partly reserved"),
  waiting: a("Waiting"),
};

/** Which waiting order arriving stock goes to first. Urgent is the exception worth seeing. */
const ORDER_PRIORITY: Record<string, StatusDescriptor> = {
  urgent: a("Urgent"),
  high: n("High"),
  normal: n("Normal"),
};

/** An order's shipping progress (`sales_orders.delivery_status`). */
const ORDER_DELIVERY_STATUS: Record<string, StatusDescriptor> = {
  none: n("Nothing to ship"),
  pending: n("To deliver"),
  partial: n("Partly delivered"),
  delivered: s("Delivered"),
  closed: n("Closed"),
};

/** Delivery and return documents, as E2's adjustments and transfers. */
const DELIVERY_STATUS: Record<string, StatusDescriptor> = {
  draft: n("Draft"),
  posted: s("Posted"),
  cancelled: n("Cancelled"),
};

const RETURN_STATUS: Record<string, StatusDescriptor> = {
  draft: n("Draft"),
  received: s("Received"),
  cancelled: n("Cancelled"),
};

/** Purchase orders (E4). *Partly received* is shown from `receipt_status` while ordered. */
const PURCHASE_ORDER_STATUS: Record<string, StatusDescriptor> = {
  draft: n("Draft"),
  ordered: n("Ordered"),
  partial: n("Partly received"),
  received: s("Received"),
  closed: n("Closed"),
  cancelled: n("Cancelled"),
};

const TASK_STATUS: Record<string, StatusDescriptor> = {
  todo: n("To do"),
  in_progress: n("In progress"),
  completed: s("Completed"),
  blocked: c("Blocked"),
};

const TASK_PRIORITY: Record<string, StatusDescriptor> = {
  high: cat("High"),
  medium: cat("Medium"),
  low: cat("Low"),
};

export const getPosInvoiceStatus = (v: string) => descriptorFrom(POS_INVOICE_STATUS, v);
export const getPosPaymentStatus = (v: string) => descriptorFrom(POS_PAYMENT_STATUS, v);
export const getOrderInvoiceStatus = (v: string) => descriptorFrom(ORDER_INVOICE_STATUS, v);
export const getCreditNoteStatus = (v: string) => descriptorFrom(CREDIT_NOTE_STATUS, v);
export const getPaymentRecordStatus = (v: string) => descriptorFrom(PAYMENT_RECORD_STATUS, v);
export const getBillStatus = (v: string) => descriptorFrom(BILL_STATUS, v);
export const getBillMatchStatus = (v: string) => descriptorFrom(BILL_MATCH_STATUS, v);
export const getPurchaseOrderBillStatus = (v: string) => descriptorFrom(PURCHASE_ORDER_BILL_STATUS, v);
/** An unpaid balance past its due date: the one invoice state that takes colour in a list. */
export const OVERDUE_STATUS: StatusDescriptor = { tone: "critical", label: "Overdue" };
export const getQuoteStatus = (v: string) => descriptorFrom(QUOTE_STATUS, v);
export const getOrderStatus = (v: string) => descriptorFrom(ORDER_STATUS, v);
export const getClientOrderStatus = (v: string) => descriptorFrom(CLIENT_ORDER_STATUS, v);
export const getOrderSource = (v: string) => descriptorFrom(ORDER_SOURCE, v);
export const getOrderAvailability = (v: string) => descriptorFrom(ORDER_AVAILABILITY, v);
export const getOrderDeliveryStatus = (v: string) => descriptorFrom(ORDER_DELIVERY_STATUS, v);
export const getOrderPriority = (v: string) => descriptorFrom(ORDER_PRIORITY, v);
export const getDeliveryStatus = (v: string) => descriptorFrom(DELIVERY_STATUS, v);
export const getReturnStatus = (v: string) => descriptorFrom(RETURN_STATUS, v);
export const getPurchaseOrderStatus = (v: string) => descriptorFrom(PURCHASE_ORDER_STATUS, v);
export const getPurchaseReceiptStatus = (v: string) => descriptorFrom(DELIVERY_STATUS, v);
export const getTaskStatus = (v: string) => descriptorFrom(TASK_STATUS, v);
export const getCatalogStockStatus = (v: string) => descriptorFrom(CATALOG_STOCK_STATUS, v);

/**
 * The two named-state booleans on a catalog record (design.md §4.7).
 *
 * They are descriptors rather than raw strings because the rail edits them through
 * `InlineFieldEdit`, which renders its closed value as a `StatusValue` — so the read-only and
 * the editable spelling of "this product is inactive" have to be the same one.
 *
 * `Active` is neutral and `Inactive` takes the tone: active is what almost every row is, and
 * a disabled product is the deviation. Public and private are a category — a product not on
 * the website is not an exception, it is a choice — so neither takes a tone (R5).
 */
export const getCatalogActiveState = (v: boolean) => (v ? n("Active") : a("Inactive"));
export const getCatalogVisibility = (v: boolean) => (v ? cat("Public") : cat("Private"));

/** Categories — classified so the label is right, toneless so nothing paints them. */
export const getLeadScoreGrade = (v: string) =>
  descriptorFrom(LEAD_SCORE_GRADE, v, { tone: null, label: "Unknown" });
export const getTaskPriority = (v: string) =>
  descriptorFrom(TASK_PRIORITY, v, { tone: null, label: "Unknown" });
