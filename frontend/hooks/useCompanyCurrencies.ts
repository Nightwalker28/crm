"use client";

import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";

type CompanyCurrencyResponse = {
  operating_currencies?: string[] | null;
};

async function fetchCompanyCurrencies(): Promise<string[]> {
  const res = await apiFetch("/users/company");
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Failed with ${res.status}`);
  }

  const body = (await res.json().catch(() => null)) as CompanyCurrencyResponse | null;
  const currencies = Array.isArray(body?.operating_currencies)
    ? body.operating_currencies
        .map((value) => String(value).trim().toUpperCase())
        .filter(Boolean)
    : [];

  return currencies.length ? Array.from(new Set(currencies)) : ["USD"];
}

export function useCompanyCurrencies(enabled = true) {
  return useQuery({
    queryKey: ["company-operating-currencies"],
    queryFn: fetchCompanyCurrencies,
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** The currency stock is valued in (ERP E6, 12d §3.1): costs, stock value and margin. */
export function useBaseCurrency(enabled = true) {
  return useQuery({
    queryKey: ["company-base-currency"],
    queryFn: async () => {
      const res = await apiFetch("/users/company");
      if (!res.ok) throw new Error(`Failed with ${res.status}`);
      const body = (await res.json().catch(() => null)) as { base_currency?: string | null; operating_currencies?: string[] | null } | null;
      return String(body?.base_currency || body?.operating_currencies?.[0] || "USD").toUpperCase();
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}
