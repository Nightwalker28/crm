"use client";

import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import { apiErrorFromResponse } from "@/lib/apiErrors";

/** Recurring invoices, payment reminders and statements (13d §3.6). */

export type RecurringLine = {
  description: string;
  quantity?: string | number;
  unit_price?: string | number;
  discount_amount?: string | number;
  discount_percent?: string | number | null;
  tax_rate_id?: number | null;
  tax_manual?: boolean;
  tax_amount?: string | number;
  line_type?: "item" | "section" | "note";
  unit?: string | null;
  catalog_product_id?: number | null;
  catalog_service_id?: number | null;
};

export type RecurringFrequency = "weekly" | "monthly" | "quarterly" | "yearly";
export type RecurringAction = "draft" | "issue_and_send";

export type RecurringInvoice = {
  id: number;
  name: string;
  customer_name: string;
  customer_email: string | null;
  customer_organization_id: number | null;
  customer_organization_name: string | null;
  customer_contact_id: number | null;
  customer_contact_name: string | null;
  currency: string;
  tax_mode: "exclusive" | "inclusive";
  lines: RecurringLine[];
  notes: string | null;
  payment_terms: string | null;
  frequency: RecurringFrequency;
  interval_count: number;
  schedule: string;
  start_date: string;
  end_date: string | null;
  max_count: number | null;
  next_run_date: string | null;
  issued_count: number;
  action: RecurringAction;
  active: boolean;
  status: "active" | "paused" | "finished";
  last_run_at: string | null;
  last_error: string | null;
  updated_at: string | null;
  subtotal_amount?: number;
  discount_amount?: number;
  tax_amount?: number;
  total_amount?: number;
  lines_error?: string;
  invoices?: Array<{ id: number; invoice_number: string | null; status: string; payment_status: string; issue_date: string | null;
    total_amount: number; balance_due: number; currency: string }>;
};

export type RecurringDraft = Partial<RecurringInvoice> & { source_invoice_id?: number; source_invoice_number?: string | null };

export type ReminderRule = {
  id: number;
  name: string;
  days_offset: number;
  subject: string;
  body: string;
  attach_pdf: boolean;
  active: boolean;
};

export type StatementKind = "activity" | "open";

export type Statement = {
  organization: { org_id: number; name: string; email: string | null };
  kind: StatementKind;
  start: string;
  end: string;
  currency: string;
  currencies: string[];
  ageing: Array<{ key: string; label: string; amount: string }>;
  opening_balance?: string;
  closing_balance: string;
  invoiced?: string;
  received?: string;
  entries?: Array<{ date: string; type: string; number: string | null; detail: string | null; debit: string; credit: string; balance: string }>;
  invoices?: Array<{ id: number; number: string | null; issue_date: string | null; due_date: string | null; total: string; balance_due: string;
    days_overdue: number }>;
  balances: Array<{ currency: string; balance_due: string; open_invoices: number }>;
};

export async function receivablesRequest<T>(path: string, init?: RequestInit, fallback = "This could not be loaded."): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) throw await apiErrorFromResponse(response, fallback);
  return response.status === 204 ? (null as T) : (response.json() as Promise<T>);
}

export function jsonBody(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export function useRecurringInvoice(id: number | null) {
  return useQuery({
    queryKey: ["recurring-invoice", id],
    queryFn: () => receivablesRequest<RecurringInvoice>(`/finance/recurring-invoices/${id}`),
    enabled: Boolean(id),
  });
}

export function useRecurringDraftFromInvoice(invoiceId: number | null) {
  return useQuery({
    queryKey: ["recurring-invoice-draft", invoiceId],
    queryFn: () => receivablesRequest<RecurringDraft>(`/finance/recurring-invoices/from-invoice/${invoiceId}`),
    enabled: Boolean(invoiceId),
    staleTime: Infinity,
  });
}

export type StatementQuery = { from?: string; to?: string; kind: StatementKind; currency?: string };

export function statementSearch(query: StatementQuery) {
  const params = new URLSearchParams({ kind: query.kind });
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.currency) params.set("currency", query.currency);
  return params.toString();
}

export function useStatement(orgId: number | null, query: StatementQuery, enabled = true) {
  return useQuery({
    queryKey: ["account-statement", orgId, query],
    queryFn: () => receivablesRequest<Statement>(`/finance/statements/${orgId}?${statementSearch(query)}`),
    enabled: Boolean(orgId) && enabled,
  });
}

export function useReminderRules() {
  return useQuery({
    queryKey: ["reminder-rules"],
    queryFn: async () => (await receivablesRequest<{ items: ReminderRule[] }>("/finance/reminder-rules")).items,
  });
}

/** "3 days before the due date", "On the due date", "7 days after the due date". */
export function reminderDayLabel(offset: number) {
  if (offset === 0) return "On the due date";
  const days = Math.abs(offset);
  return `${days} day${days === 1 ? "" : "s"} ${offset < 0 ? "before" : "after"} the due date`;
}
