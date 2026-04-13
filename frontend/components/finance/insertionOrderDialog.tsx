"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Checkbox, CheckboxIndicator } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api";
import type { InsertionOrder, InsertionOrderPayload } from "@/hooks/finance/useInsertionOrders";

type Props = {
  open: boolean;
  order: InsertionOrder | null;
  isSubmitting?: boolean;
  onClose: () => void;
  onSubmit: (payload: InsertionOrderPayload) => Promise<void>;
};

type FormState = {
  customer_name: string;
  customer_organization_id: number | null;
  create_customer_if_missing: boolean;
  counterparty_reference: string;
  external_reference: string;
  issue_date: string;
  effective_date: string;
  due_date: string;
  start_date: string;
  end_date: string;
  status: string;
  currency: string;
  subtotal_amount: string;
  tax_amount: string;
  total_amount: string;
  notes: string;
};

const emptyForm: FormState = {
  customer_name: "",
  customer_organization_id: null,
  create_customer_if_missing: false,
  counterparty_reference: "",
  external_reference: "",
  issue_date: "",
  effective_date: "",
  due_date: "",
  start_date: "",
  end_date: "",
  status: "draft",
  currency: "USD",
  subtotal_amount: "",
  tax_amount: "",
  total_amount: "",
  notes: "",
};

const statusOptions = ["draft", "issued", "active", "completed", "cancelled"];

type CustomerOption = {
  org_id: number;
  org_name: string;
  primary_email?: string | null;
};

async function fetchCustomerOptions(search: string): Promise<CustomerOption[]> {
  const params = new URLSearchParams({
    page: "1",
    page_size: "6",
    search,
  });

  const res = await apiFetch(`/sales/organizations?${params.toString()}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Failed with ${res.status}`);
  }

  const body = await res.json().catch(() => ({ results: [] }));
  return Array.isArray(body?.results) ? body.results : [];
}

function toFormState(order: InsertionOrder | null): FormState {
  if (!order) return emptyForm;
  return {
    customer_name: order.customer_name ?? "",
    customer_organization_id: order.customer_organization_id ?? null,
    create_customer_if_missing: false,
    counterparty_reference: order.counterparty_reference ?? "",
    external_reference: order.external_reference ?? "",
    issue_date: order.issue_date ?? "",
    effective_date: order.effective_date ?? "",
    due_date: order.due_date ?? "",
    start_date: order.start_date ?? "",
    end_date: order.end_date ?? "",
    status: order.status ?? "draft",
    currency: order.currency ?? "USD",
    subtotal_amount: order.subtotal_amount != null ? String(order.subtotal_amount) : "",
    tax_amount: order.tax_amount != null ? String(order.tax_amount) : "",
    total_amount: order.total_amount != null ? String(order.total_amount) : "",
    notes: order.notes ?? "",
  };
}

function toOptionalNumber(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
}

function RequiredAsterisk() {
  return <span className="text-red-400">*</span>;
}

export default function InsertionOrderDialog({ open, order, isSubmitting = false, onClose, onSubmit }: Props) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const deferredCustomerSearch = useDeferredValue(form.customer_name.trim());

  const customerQuery = useQuery({
    queryKey: ["finance-io-customer-options", deferredCustomerSearch],
    queryFn: () => fetchCustomerOptions(deferredCustomerSearch),
    enabled: open && deferredCustomerSearch.length > 0 && form.customer_organization_id == null,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (open) {
      setForm(toFormState(order));
      setError(null);
    }
  }, [open, order]);

  const isEditMode = Boolean(order);
  const canSubmit = useMemo(() => form.customer_name.trim().length > 0, [form.customer_name]);
  const customerOptions = customerQuery.data ?? [];
  const hasExactCustomerMatch = customerOptions.some(
    (option) => option.org_name.trim().toLowerCase() === form.customer_name.trim().toLowerCase(),
  );

  function handleClose() {
    setForm(emptyForm);
    setError(null);
    onClose();
  }

  async function handleSubmit() {
    try {
      setError(null);
      await onSubmit({
        customer_name: form.customer_name.trim(),
        customer_organization_id: form.customer_organization_id,
        create_customer_if_missing: form.customer_organization_id == null && form.create_customer_if_missing,
        counterparty_reference: form.counterparty_reference.trim() || undefined,
        external_reference: form.external_reference.trim() || undefined,
        issue_date: form.issue_date || undefined,
        effective_date: form.effective_date || undefined,
        due_date: form.due_date || undefined,
        start_date: form.start_date || undefined,
        end_date: form.end_date || undefined,
        status: form.status,
        currency: form.currency.trim().toUpperCase() || "USD",
        subtotal_amount: toOptionalNumber(form.subtotal_amount),
        tax_amount: toOptionalNumber(form.tax_amount),
        total_amount: toOptionalNumber(form.total_amount),
        notes: form.notes.trim() || undefined,
      });
      handleClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to save insertion order");
    }
  }

  return (
    <Dialog open={open} onClose={handleClose}>
      <DialogBackdrop />
      <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-3xl">
          <DialogHeader>
            <DialogTitle>{isEditMode ? "Edit Insertion Order" : "Create Insertion Order"}</DialogTitle>
            <DialogClose className="cursor-pointer text-neutral-400/70 hover:text-red-400/90">
              Close
            </DialogClose>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {error && (
              <div className="rounded-md border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            )}

            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel>
                  Customer Name <RequiredAsterisk />
                </FieldLabel>
                <Input
                  value={form.customer_name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      customer_name: event.target.value,
                      customer_organization_id: null,
                    }))
                  }
                  placeholder="Acme Holdings"
                />
                <FieldDescription>
                  Search and link an existing customer, or type a new one and create a lightweight customer record.
                </FieldDescription>

                {form.customer_organization_id != null ? (
                  <div className="mt-2 flex items-center justify-between rounded-md border border-emerald-800/60 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200">
                    <span>Linked to an existing customer record.</span>
                    <button
                      type="button"
                      className="text-xs font-medium uppercase tracking-wide text-emerald-100 hover:text-white"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          customer_organization_id: null,
                        }))
                      }
                    >
                      Unlink
                    </button>
                  </div>
                ) : null}

                {form.customer_organization_id == null && deferredCustomerSearch ? (
                  <div className="mt-2 rounded-md border border-neutral-800 bg-neutral-950/70">
                    {customerQuery.isLoading ? (
                      <div className="px-3 py-2 text-sm text-neutral-500">Searching customers…</div>
                    ) : customerOptions.length ? (
                      <div className="max-h-48 overflow-y-auto py-1">
                        {customerOptions.map((option) => (
                          <button
                            key={option.org_id}
                            type="button"
                            className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-neutral-900"
                            onClick={() =>
                              setForm((current) => ({
                                ...current,
                                customer_name: option.org_name,
                                customer_organization_id: option.org_id,
                                create_customer_if_missing: false,
                              }))
                            }
                          >
                            <span className="text-sm text-neutral-100">{option.org_name}</span>
                            <span className="text-xs text-neutral-500">{option.primary_email || "Existing customer"}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="px-3 py-2 text-sm text-neutral-500">No existing customers matched this name.</div>
                    )}
                  </div>
                ) : null}

                {form.customer_organization_id == null && form.customer_name.trim() && !hasExactCustomerMatch ? (
                  <label className="mt-3 flex items-start gap-3 rounded-md border border-neutral-800 bg-neutral-950/60 px-3 py-3 text-sm text-neutral-300">
                    <Checkbox
                      checked={form.create_customer_if_missing}
                      onCheckedChange={(checked) =>
                        setForm((current) => ({
                          ...current,
                          create_customer_if_missing: checked === true,
                        }))
                      }
                      className="mt-0.5 flex h-4 w-4 items-center justify-center rounded border border-neutral-700 bg-neutral-900 text-white"
                    >
                      <CheckboxIndicator className="h-3 w-3" />
                    </Checkbox>
                    <span>Create a lightweight customer record if no existing customer matches this name.</span>
                  </label>
                ) : null}
              </Field>

              <Field>
                <FieldLabel>Counterparty Reference</FieldLabel>
                <Input
                  value={form.counterparty_reference}
                  onChange={(event) => setForm((current) => ({ ...current, counterparty_reference: event.target.value }))}
                  placeholder="PO-4821"
                />
              </Field>

              <Field>
                <FieldLabel>External Reference</FieldLabel>
                <Input
                  value={form.external_reference}
                  onChange={(event) => setForm((current) => ({ ...current, external_reference: event.target.value }))}
                  placeholder="Vendor reference or filename"
                />
              </Field>

              <Field>
                <FieldLabel>
                  Status <RequiredAsterisk />
                </FieldLabel>
                <Select value={form.status} onValueChange={(value) => setForm((current) => ({ ...current, status: value }))}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statusOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option.charAt(0).toUpperCase() + option.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel>
                  Currency <RequiredAsterisk />
                </FieldLabel>
                <Input
                  value={form.currency}
                  onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))}
                  placeholder="USD"
                  maxLength={3}
                />
              </Field>

              <Field>
                <FieldLabel>Issue Date</FieldLabel>
                <Input
                  type="date"
                  value={form.issue_date}
                  onChange={(event) => setForm((current) => ({ ...current, issue_date: event.target.value }))}
                />
              </Field>

              <Field>
                <FieldLabel>Effective Date</FieldLabel>
                <Input
                  type="date"
                  value={form.effective_date}
                  onChange={(event) => setForm((current) => ({ ...current, effective_date: event.target.value }))}
                />
              </Field>

              <Field>
                <FieldLabel>Due Date</FieldLabel>
                <Input
                  type="date"
                  value={form.due_date}
                  onChange={(event) => setForm((current) => ({ ...current, due_date: event.target.value }))}
                />
              </Field>

              <Field>
                <FieldLabel>Start Date</FieldLabel>
                <Input
                  type="date"
                  value={form.start_date}
                  onChange={(event) => setForm((current) => ({ ...current, start_date: event.target.value }))}
                />
              </Field>

              <Field>
                <FieldLabel>End Date</FieldLabel>
                <Input
                  type="date"
                  value={form.end_date}
                  onChange={(event) => setForm((current) => ({ ...current, end_date: event.target.value }))}
                />
              </Field>

              <Field>
                <FieldLabel>Subtotal</FieldLabel>
                <Input
                  type="number"
                  step="0.01"
                  value={form.subtotal_amount}
                  onChange={(event) => setForm((current) => ({ ...current, subtotal_amount: event.target.value }))}
                  placeholder="0.00"
                />
              </Field>

              <Field>
                <FieldLabel>Tax</FieldLabel>
                <Input
                  type="number"
                  step="0.01"
                  value={form.tax_amount}
                  onChange={(event) => setForm((current) => ({ ...current, tax_amount: event.target.value }))}
                  placeholder="0.00"
                />
              </Field>

              <Field>
                <FieldLabel>Total</FieldLabel>
                <Input
                  type="number"
                  step="0.01"
                  value={form.total_amount}
                  onChange={(event) => setForm((current) => ({ ...current, total_amount: event.target.value }))}
                  placeholder="0.00"
                />
                <FieldDescription>Leave blank if the total is still being finalized.</FieldDescription>
              </Field>

              <Field className="sm:col-span-2">
                <FieldLabel>Notes</FieldLabel>
                <Textarea
                  value={form.notes}
                  onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Internal context, payment terms, or delivery notes"
                  rows={4}
                />
              </Field>
            </FieldGroup>
          </div>

          <DialogFooter className="mt-5">
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? "Saving..." : isEditMode ? "Save Changes" : "Create Order"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
