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

const INSERTION_ORDER_STATUS: Record<string, StatusDescriptor> = {
  draft: n("Draft"),
  issued: n("Issued"),
  active: n("Active"),
  imported: n("Imported"),
  completed: s("Completed"),
  cancelled: c("Cancelled"),
};

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

const CONTRACT_STATUS: Record<string, StatusDescriptor> = {
  draft: n("Draft"),
  review: n("Review"),
  sent: n("Sent"),
  active: n("Active"),
  signed: s("Signed"),
  partially_signed: a("Partially signed"),
  expired: a("Expired"),
  cancelled: c("Cancelled"),
};

const POS_INVOICE_STATUS: Record<string, StatusDescriptor> = {
  draft: n("Draft"),
  issued: n("Issued"),
  paid: s("Paid"),
  void: c("Void"),
};

const POS_PAYMENT_STATUS: Record<string, StatusDescriptor> = {
  // `unpaid` and `partial` are the *normal* state of a recent invoice, so colouring them makes
  // an AR list mostly amber and re-creates exactly the noise R5 removes. What deserves
  // attention is **overdue**, which is derived (`due_date < today && status !== "paid"`) rather
  // than an enum value — the caller computes it and passes `tone` to `StatusValue` directly.
  unpaid: n("Unpaid"),
  partial: n("Partially paid"),
  refunded: n("Refunded"),
  paid: s("Paid"),
};

const OPPORTUNITY_STAGE: Record<string, StatusDescriptor> = {
  lead: n("Lead"),
  qualified: n("Qualified"),
  proposal: n("Proposal"),
  negotiation: n("Negotiation"),
  unstaged: n("Unstaged"),
  closed_won: s("Closed won"),
  closed_lost: c("Closed lost"),
};

const LEAD_STATUS: Record<string, StatusDescriptor> = {
  new: n("New"),
  contacted: n("Contacted"),
  qualified: n("Qualified"),
  unqualified: n("Unqualified"),
  converted: s("Converted"),
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

const SUPPORT_CASE_STATUS: Record<string, StatusDescriptor> = {
  new: n("New"),
  open: n("Open"),
  closed: n("Closed"),
  resolved: s("Resolved"),
  pending: a("Pending"),
};

const SUPPORT_CASE_PRIORITY: Record<string, StatusDescriptor> = {
  low: n("Low"),
  medium: n("Medium"),
  high: a("High"),
  urgent: c("Urgent"),
};

export const getInsertionOrderStatus = (v: string) => descriptorFrom(INSERTION_ORDER_STATUS, v);
export const getContractStatus = (v: string) => descriptorFrom(CONTRACT_STATUS, v);
export const getPosInvoiceStatus = (v: string) => descriptorFrom(POS_INVOICE_STATUS, v);
export const getPosPaymentStatus = (v: string) => descriptorFrom(POS_PAYMENT_STATUS, v);
export const getOpportunityStage = (v: string) =>
  descriptorFrom(OPPORTUNITY_STAGE, v || "unstaged");
export const getLeadStatus = (v: string) => descriptorFrom(LEAD_STATUS, v);
export const getQuoteStatus = (v: string) => descriptorFrom(QUOTE_STATUS, v);
export const getOrderStatus = (v: string) => descriptorFrom(ORDER_STATUS, v);
export const getTaskStatus = (v: string) => descriptorFrom(TASK_STATUS, v);
export const getSupportCaseStatus = (v: string) => descriptorFrom(SUPPORT_CASE_STATUS, v);
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
export const getSupportCasePriority = (v: string) => descriptorFrom(SUPPORT_CASE_PRIORITY, v);

/** Categories — classified so the label is right, toneless so nothing paints them. */
export const getLeadScoreGrade = (v: string) =>
  descriptorFrom(LEAD_SCORE_GRADE, v, { tone: null, label: "Unknown" });
export const getTaskPriority = (v: string) =>
  descriptorFrom(TASK_PRIORITY, v, { tone: null, label: "Unknown" });
