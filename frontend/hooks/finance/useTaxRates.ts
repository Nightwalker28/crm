"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, apiFetch } from "@/lib/api";

/** A tax rate, or a group whose rate is its members' sum (13d §3.1). */
export type TaxRate = {
  id: number;
  name: string;
  kind: "rate" | "group";
  rate: string;
  is_active: boolean;
  is_default_sales: boolean;
  is_default_purchases: boolean;
  members: Array<{ id: number; name: string; rate: string }>;
};

export type TaxMode = "exclusive" | "inclusive";

export type TaxRatePayload = {
  name?: string;
  kind?: "rate" | "group";
  rate?: string;
  member_ids?: number[];
  is_active?: boolean;
  is_default_sales?: boolean;
  is_default_purchases?: boolean;
};

/** One row of a document's tax summary: tax by rate, a group shown as its components. */
export type TaxSummaryRow = {
  tax_rate_id: number | null;
  name: string;
  rate: string | number | null;
  taxable: string | number;
  tax: string | number;
  group?: string;
};

const QUERY_KEY = ["finance", "tax-rates"];

async function request(path: string, init: RequestInit, fallback: string) {
  const res = await apiFetch(path, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: unknown } | null;
    const detail = res.status < 500 && typeof body?.detail === "string" ? body.detail : fallback;
    throw new ApiError(res.status, detail);
  }
  return res.status === 204 ? null : res.json();
}

/** Every rate, inactive ones too, so a saved line still names the rate it was computed from. */
export function useTaxRates(enabled = true) {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<TaxRate[]> => {
      const body = await request("/finance/tax-rates?include_inactive=true", {}, "Tax rates could not be loaded.");
      return Array.isArray(body?.items) ? body.items : [];
    },
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

/** The company's default: whether new documents' prices include tax. */
export function useDefaultTaxMode(enabled = true) {
  return useQuery({
    queryKey: ["company-default-tax-mode"],
    queryFn: async (): Promise<TaxMode> => {
      const res = await apiFetch("/users/company");
      if (!res.ok) throw new Error(`Failed with ${res.status}`);
      const body = (await res.json().catch(() => null)) as { default_tax_mode?: string } | null;
      return body?.default_tax_mode === "inclusive" ? "inclusive" : "exclusive";
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useTaxRateActions() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  const json = (method: string, payload: TaxRatePayload): RequestInit => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const create = useMutation({
    mutationFn: (payload: TaxRatePayload) => request("/finance/tax-rates", json("POST", payload), "The tax rate could not be added."),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: TaxRatePayload }) =>
      request(`/finance/tax-rates/${id}`, json("PATCH", payload), "The tax rate could not be saved."),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: number) => request(`/finance/tax-rates/${id}`, { method: "DELETE" }, "The tax rate could not be deleted."),
    onSuccess: invalidate,
  });
  return { create, update, remove };
}
